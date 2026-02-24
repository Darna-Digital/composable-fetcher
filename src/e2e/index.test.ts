import { describe, it, expect } from 'vitest';
import { createComposableFetcher } from '../composable-fetcher.js';
import type { FetchError } from '../entity/composable-fetcher.interfaces.js';
import {
  createFailingMockSchema,
  createMockSchema,
} from '../functions/composable-fetcher.functions.mock.js';
import { createFakeApi } from './index.js';

describe('e2e: input validation', () => {
  it('validates input and sends the request on success', async () => {
    const server = createFakeApi();
    const api = createComposableFetcher({ fetchFn: server.fetch });

    server.post('/api/users', ({ body }) => ({
      status: 200,
      statusText: 'OK',
      body: { id: 1, ...(body as Record<string, unknown>) },
    }));

    const result = await api
      .url('/api/users')
      .input(createMockSchema({ name: '', email: '' }))
      .body({ name: 'Alice', email: 'alice@example.com' })
      .schema(createMockSchema({ id: 1, name: 'Alice', email: 'alice@example.com' }))
      .run('POST');

    expect(result).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('rejects invalid input before sending the request', async () => {
    const server = createFakeApi();
    const api = createComposableFetcher({ fetchFn: server.fetch });

    server.post('/api/users', () => ({
      status: 200,
      statusText: 'OK',
      body: { id: 1 },
    }));

    try {
      await api
        .url('/api/users')
        .input(createFailingMockSchema('email is required'))
        .body({ name: 'Alice' })
        .run('POST');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('input');
      if (fe.type === 'input') {
        expect(fe.issues).toContain('email is required');
      }
    }
  });

  it('catches input validation errors via .catch() handler', async () => {
    const server = createFakeApi();
    const api = createComposableFetcher({ fetchFn: server.fetch });

    server.post('/api/items', () => ({
      status: 200,
      statusText: 'OK',
      body: { ok: true },
    }));

    let capturedError: FetchError | undefined;

    await api
      .url('/api/items')
      .input(createFailingMockSchema('invalid fields'))
      .body({ title: 123, count: 'not a number' })
      .catch(({ error }) => {
        capturedError = error;
      })
      .run('POST');

    expect(capturedError).toBeDefined();
    expect(capturedError!.type).toBe('input');
    if (capturedError!.type === 'input') {
      expect(capturedError!.issues).toContain('invalid fields');
    }
  });

  it('works without .input() (backwards compatible)', async () => {
    const server = createFakeApi();
    const api = createComposableFetcher({ fetchFn: server.fetch });

    server.post('/api/users', ({ body }) => ({
      status: 200,
      statusText: 'OK',
      body: { id: 1, ...(body as Record<string, unknown>) },
    }));

    const result = await api
      .url('/api/users')
      .body({ anything: 'goes' })
      .schema(createMockSchema({ id: 1 }))
      .run('POST');

    expect(result).toEqual({ id: 1, anything: 'goes' });
  });

  it('combines input validation with error schema and catch', async () => {
    const server = createFakeApi();
    const api = createComposableFetcher({ fetchFn: server.fetch });

    server.post('/api/users', () => ({
      status: 422,
      statusText: 'Unprocessable Entity',
      body: { error: 'Email already taken', code: 1001 },
    }));

    let capturedError: FetchError | undefined;

    await api
      .url('/api/users')
      .input(createMockSchema({ name: '', email: '' }))
      .body({ name: 'Alice', email: 'alice@example.com' })
      .errorSchema(
        createMockSchema({ error: '', code: 0 }),
        (data) => data.error,
      )
      .catch(({ error }) => {
        capturedError = error;
      })
      .run('POST');

    expect(capturedError).toBeDefined();
    expect(capturedError!.type).toBe('http');
    if (capturedError!.type === 'http') {
      expect(capturedError!.status).toBe(422);
      expect(capturedError!.message).toBe('Email already taken');
      expect(capturedError!.data).toEqual({ error: 'Email already taken', code: 1001 });
    }
  });

  it('sends the transformed value from a validating schema', async () => {
    const server = createFakeApi();
    const api = createComposableFetcher({ fetchFn: server.fetch });

    const trimmingSchema = {
      '~standard': {
        version: 1 as const,
        validate: (value: unknown) => {
          const obj = value as Record<string, unknown>;
          if (typeof obj.name !== 'string')
            return { issues: [{ message: 'name must be a string' }] };

          return {
            value: { name: obj.name.trim(), createdAt: '2026-02-24T00:00:00Z' },
          };
        },
      },
    };

    let receivedBody: unknown;
    server.post('/api/users', ({ body }) => {
      receivedBody = body;
      return { status: 200, statusText: 'OK', body: { ok: true } };
    });

    await api
      .url('/api/users')
      .input(trimmingSchema)
      .body({ name: '  Alice  ' } as any)
      .run('POST');

    expect(receivedBody).toEqual({
      name: 'Alice',
      createdAt: '2026-02-24T00:00:00Z',
    });
  });
});

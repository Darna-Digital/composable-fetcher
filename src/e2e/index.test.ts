import { describe, it, expect } from 'vitest';
import { createComposableFetcher } from '../composable-fetcher.js';
import type { FetchError } from '../entity/composable-fetcher.interfaces.js';
import { createFakeApi } from './index.js';

function createStrictSchema<T extends Record<string, unknown>>(
  shape: { [K in keyof T]: (v: unknown) => v is T[K] },
) {
  return {
    '~standard': {
      version: 1 as const,
      validate: (value: unknown) => {
        if (typeof value !== 'object' || value === null)
          return { issues: [{ message: 'Expected an object' }] };

        const obj = value as Record<string, unknown>;
        const issues: Array<{ message: string }> = [];

        for (const [key, check] of Object.entries(shape)) {
          if (!(key in obj))
            issues.push({ message: `Missing required field: ${key}` });
          else if (!check(obj[key]))
            issues.push({ message: `Invalid type for field: ${key}` });
        }

        if (issues.length > 0) return { issues };
        return { value: value as T };
      },
    },
  };
}

function createPassthroughSchema<T>() {
  return {
    '~standard': {
      version: 1 as const,
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';

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
      .input(createStrictSchema({ name: isString, email: isString }))
      .body({ name: 'Alice', email: 'alice@example.com' })
      .schema(createPassthroughSchema<{ id: number; name: string; email: string }>())
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
        .input(createStrictSchema({ name: isString, email: isString }))
        .body({ name: 'Alice' } as any)
        .run('POST');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('input');
      if (fe.type === 'input') {
        expect(fe.issues).toContain('Missing required field: email');
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
      .input(createStrictSchema({ title: isString, count: isNumber }))
      .body({ title: 123, count: 'not a number' } as any)
      .catch(({ error }) => {
        capturedError = error;
      })
      .run('POST');

    expect(capturedError).toBeDefined();
    expect(capturedError!.type).toBe('input');
    if (capturedError!.type === 'input') {
      expect(capturedError!.issues).toContain('Invalid type for field: title');
      expect(capturedError!.issues).toContain('Invalid type for field: count');
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
      .schema(createPassthroughSchema<{ id: number }>())
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
      .input(createStrictSchema({ name: isString, email: isString }))
      .body({ name: 'Alice', email: 'alice@example.com' })
      .errorSchema(
        createPassthroughSchema<{ error: string; code: number }>(),
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
            value: {
              name: obj.name.trim(),
              createdAt: '2026-02-24T00:00:00Z',
            },
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

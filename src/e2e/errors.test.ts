import { describe, it, expect, vi } from 'vitest';
import { createComposableFetcher, toError } from '../index.js';
import type { FetchError } from '../index.js';
import { createMockSchema } from '../functions/composable-fetcher.functions.mock.js';
import { createFakeApi, createFailingFetch } from './index.js';

type User = { id: string; name: string; email: string };
type ApiError = { code: string; message: string };
type ValidationError = {
  violations: Array<{ field: string; message: string }>;
};

describe('e2e: HTTP error handling', () => {
  it('throws on 404 with default { error } body decoding', async () => {
    const server = createFakeApi();
    server.get('/api/users/999', () => ({
      status: 404,
      statusText: 'Not Found',
      body: { error: 'User not found' },
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    try {
      await api
        .url('/api/users/999')
        .schema(createMockSchema<User>({ id: '', name: '', email: '' }))
        .run('GET');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      if (fe.type === 'http') {
        expect(fe.status).toBe(404);
        expect(fe.message).toBe('User not found');
      }
    }
  });

  it('uses fallback message when server returns unrecognized error body', async () => {
    const server = createFakeApi();
    server.get('/api/broken', () => ({
      status: 500,
      statusText: 'Internal Server Error',
      body: { unexpected: 'structure' },
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    try {
      await api
        .url('/api/broken')
        .schema(createMockSchema<unknown>(null))
        .fallback('Something went wrong, please try again')
        .run('GET');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      expect(fe.message).toBe('Something went wrong, please try again');
    }
  });

  it('decodes structured error with errorSchema and errorMessage', async () => {
    const server = createFakeApi();
    const errorPayload: ApiError = {
      code: 'VALIDATION_ERROR',
      message: 'Email is already taken',
    };

    server.post('/api/users', () => ({
      status: 422,
      statusText: 'Unprocessable Entity',
      body: errorPayload,
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    try {
      await api
        .url('/api/users')
        .body({ name: 'Eve', email: 'taken@example.com' })
        .errorSchema(
          createMockSchema<ApiError>(errorPayload),
          (data) => data.message,
        )
        .run('POST');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      if (fe.type === 'http') {
        expect(fe.status).toBe(422);
        expect(fe.message).toBe('Email is already taken');
        expect(fe.data).toEqual(errorPayload);
      }
    }
  });

  it('decodes validation violations from errorSchema', async () => {
    const violationsPayload: ValidationError = {
      violations: [
        { field: 'email', message: 'invalid format' },
        { field: 'name', message: 'too short' },
      ],
    };

    const server = createFakeApi();
    server.post('/api/users', () => ({
      status: 422,
      statusText: 'Unprocessable Entity',
      body: violationsPayload,
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    let capturedData: ValidationError | undefined;

    await api
      .url('/api/users')
      .body({ name: '', email: 'bad' })
      .errorSchema(
        createMockSchema<ValidationError>(violationsPayload),
        (data) =>
          data.violations
            .map((v: { field: string; message: string }) => `${v.field}: ${v.message}`)
            .join('; '),
      )
      .catch(({ error }) => {
        if (error.type === 'http') {
          capturedData = error.data as ValidationError;
        }
      })
      .run('POST');

    expect(capturedData).toBeDefined();
    expect(capturedData!.violations).toHaveLength(2);
    expect(capturedData!.violations[0].field).toBe('email');
    expect(capturedData!.violations[1].field).toBe('name');
  });

  it('server returning non-JSON error body uses fallback message', async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      });
    };

    const api = createComposableFetcher({ fetchFn });

    try {
      await api
        .url('/api/broken')
        .fallback('The server returned an unexpected response')
        .run('GET');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      expect(fe.message).toBe('The server returned an unexpected response');
    }
  });
});

describe('e2e: network errors', () => {
  it('throws FetchError.network when the network is down', async () => {
    const api = createComposableFetcher({ fetchFn: createFailingFetch() });

    try {
      await api
        .url('/api/users')
        .schema(createMockSchema<unknown>(null))
        .run('GET');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('network');
      expect(fe.message).toContain('Failed to fetch');
    }
  });

  it('catch handler receives network error and can swallow it', async () => {
    const api = createComposableFetcher({ fetchFn: createFailingFetch() });

    const handler = vi.fn();

    const result = await api
      .url('/api/users')
      .schema(createMockSchema<unknown>(null))
      .catch(handler)
      .run('GET');

    expect(result).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].error.type).toBe('network');
  });
});

describe('e2e: toError utility', () => {
  it('converts FetchError to throwable Error with .fetchError property', () => {
    const fetchError: FetchError = {
      type: 'http',
      status: 404,
      statusText: 'Not Found',
      message: 'Resource not found',
    };

    const err = toError(fetchError);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Resource not found');
    expect(err.name).toBe('FetchError.http');
    expect(err.fetchError).toBe(fetchError);
  });

  it('converts network FetchError properly', () => {
    const fetchError: FetchError = {
      type: 'network',
      message: 'Network error: Failed to fetch',
    };

    const err = toError(fetchError);
    expect(err.name).toBe('FetchError.network');
    expect(err.fetchError.type).toBe('network');
  });
});

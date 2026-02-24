/**
 * End-to-end tests for composable-fetcher.
 *
 * These tests simulate real-world usage by creating a fake API server
 * (promise-based) and driving the library through its public API —
 * exactly as a consumer would. All schemas use the library's own
 * test utilities (`createMockSchema`, `createFailingMockSchema`).
 */

import { describe, it, expect, vi } from 'vitest';
import { createComposableFetcher, toError } from '../index.js';
import type { FetchError, SpanEvent } from '../index.js';
import {
  createMockSchema,
  createFailingMockSchema,
} from '../functions/composable-fetcher.functions.mock.js';
import { createFakeApi, createFailingFetch } from './index.js';

// ---------------------------------------------------------------------------
// Shared types (for readability only — schemas use createMockSchema)
// ---------------------------------------------------------------------------

type User = { id: string; name: string; email: string };
type UserList = { users: User[]; total: number };
type ApiError = { code: string; message: string };
type ValidationError = {
  violations: Array<{ field: string; message: string }>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('e2e: GET requests with schema validation', () => {
  it('fetches and validates a list of users', async () => {
    const server = createFakeApi();
    const usersPayload: UserList = {
      users: [
        { id: '1', name: 'Alice', email: 'alice@example.com' },
        { id: '2', name: 'Bob', email: 'bob@example.com' },
      ],
      total: 2,
    };

    server.get('/api/users', () => ({
      status: 200,
      statusText: 'OK',
      body: usersPayload,
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    const result = await api
      .url('/api/users')
      .schema(createMockSchema<UserList>(usersPayload))
      .run('GET');

    expect(result).toEqual(usersPayload);
  });

  it('fetches a single user by URL', async () => {
    const server = createFakeApi();
    server.get('/api/users/42', () => ({
      status: 200,
      statusText: 'OK',
      body: { id: '42', name: 'Charlie', email: 'charlie@example.com' },
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    const user = await api
      .url('/api/users/42')
      .schema(createMockSchema<User>({ id: '42', name: 'Charlie', email: 'charlie@example.com' }))
      .run('GET');

    expect(user.id).toBe('42');
    expect(user.name).toBe('Charlie');
  });

  it('throws a parse error when schema validation fails', async () => {
    const server = createFakeApi();
    server.get('/api/users', () => ({
      status: 200,
      statusText: 'OK',
      body: { items: [] }, // server returns data, but schema rejects it
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    try {
      await api
        .url('/api/users')
        .schema(createFailingMockSchema('users must be an array'))
        .run('GET');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('parse');
      if (fe.type === 'parse') {
        expect(fe.issues).toContain('users must be an array');
      }
    }
  });
});

describe('e2e: mutations (POST, PUT, PATCH, DELETE)', () => {
  it('creates a user via POST and validates response', async () => {
    const server = createFakeApi();
    server.post('/api/users', ({ body }) => {
      const b = body as { name: string; email: string };
      return {
        status: 201,
        statusText: 'Created',
        body: { id: '99', name: b.name, email: b.email },
      };
    });

    const api = createComposableFetcher({ fetchFn: server.fetch });

    const user = await api
      .url('/api/users')
      .schema(createMockSchema<User>({ id: '99', name: 'Dave', email: 'dave@example.com' }))
      .body({ name: 'Dave', email: 'dave@example.com' })
      .run('POST');

    expect(user).toEqual({
      id: '99',
      name: 'Dave',
      email: 'dave@example.com',
    });
  });

  it('sends JSON body and Content-Type header for mutations', async () => {
    const server = createFakeApi();
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;

    server.put('/api/users/1', ({ headers, body }) => {
      capturedHeaders = headers;
      capturedBody = body;
      return {
        status: 200,
        statusText: 'OK',
        body: { id: '1', name: 'Updated', email: 'updated@example.com' },
      };
    });

    const api = createComposableFetcher({ fetchFn: server.fetch });

    await api
      .url('/api/users/1')
      .schema(createMockSchema<User>({ id: '1', name: 'Updated', email: 'updated@example.com' }))
      .body({ name: 'Updated', email: 'updated@example.com' })
      .run('PUT');

    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedBody).toEqual({
      name: 'Updated',
      email: 'updated@example.com',
    });
  });

  it('returns undefined for void DELETE mutations', async () => {
    const server = createFakeApi();
    server.delete('/api/users/1', () => ({
      status: 204,
      statusText: 'No Content',
      body: null,
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    const result = await api.url('/api/users/1').run('DELETE');

    expect(result).toBeUndefined();
  });

  it('sends PATCH request with partial body', async () => {
    const server = createFakeApi();
    let capturedBody: unknown;

    server.patch('/api/users/1', ({ body }) => {
      capturedBody = body;
      return {
        status: 200,
        statusText: 'OK',
        body: {
          id: '1',
          name: 'Patched',
          email: 'original@example.com',
        },
      };
    });

    const api = createComposableFetcher({ fetchFn: server.fetch });

    const user = await api
      .url('/api/users/1')
      .schema(createMockSchema<User>({ id: '1', name: 'Patched', email: 'original@example.com' }))
      .body({ name: 'Patched' })
      .run('PATCH');

    expect(user.name).toBe('Patched');
    expect(capturedBody).toEqual({ name: 'Patched' });
  });
});

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
        (data) => data.violations.map((v: { field: string; message: string }) => `${v.field}: ${v.message}`).join('; '),
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
});

describe('e2e: network errors', () => {
  it('throws FetchError.network when the network is down', async () => {
    const api = createComposableFetcher({ fetchFn: createFailingFetch() });

    try {
      await api
        .url('/api/users')
        .schema(createMockSchema<UserList>({ users: [], total: 0 }))
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
      .schema(createMockSchema<UserList>({ users: [], total: 0 }))
      .catch(handler)
      .run('GET');

    expect(result).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].error.type).toBe('network');
  });
});

describe('e2e: catch handler and retry', () => {
  it('retries a 401 with refreshed token and succeeds', async () => {
    let tokenVersion = 0;
    const userPayload: User = { id: '1', name: 'Alice', email: 'alice@example.com' };

    const server = createFakeApi();
    server.get('/api/profile', ({ headers }) => {
      if (headers['Authorization'] !== 'Bearer valid-token') {
        return {
          status: 401,
          statusText: 'Unauthorized',
          body: { error: 'Invalid token' },
        };
      }
      return { status: 200, statusText: 'OK', body: userPayload };
    });

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      headers: { Authorization: 'Bearer expired-token' },
      catch: async ({ error, retry }) => {
        if (error.type === 'http' && error.status === 401 && tokenVersion === 0) {
          tokenVersion++;
          return retry({ headers: { Authorization: 'Bearer valid-token' } });
        }
      },
    });

    const user = await api
      .url('/api/profile')
      .schema(createMockSchema<User>(userPayload))
      .run('GET');

    expect(user).toEqual(userPayload);
    expect(tokenVersion).toBe(1);
  });

  it('per-request catch overrides global catch', async () => {
    const server = createFakeApi();
    server.get('/api/test', () => ({
      status: 403,
      statusText: 'Forbidden',
      body: { error: 'Access denied' },
    }));

    const globalCatch = vi.fn();
    const requestCatch = vi.fn();

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      catch: globalCatch,
    });

    await api
      .url('/api/test')
      .catch(requestCatch)
      .run('GET');

    expect(requestCatch).toHaveBeenCalledTimes(1);
    expect(globalCatch).not.toHaveBeenCalled();
  });

  it('swallows error when catch handler returns undefined', async () => {
    const server = createFakeApi();
    server.get('/api/flaky', () => ({
      status: 503,
      statusText: 'Service Unavailable',
      body: { error: 'Temporarily unavailable' },
    }));

    const api = createComposableFetcher({ fetchFn: server.fetch });

    const result = await api
      .url('/api/flaky')
      .schema(createMockSchema<UserList>({ users: [], total: 0 }))
      .catch(() => {
        // swallow — return nothing
      })
      .run('GET');

    expect(result).toBeUndefined();
  });

  it('does not retry infinitely — second failure throws', async () => {
    const server = createFakeApi();
    server.get('/api/always-fails', () => ({
      status: 401,
      statusText: 'Unauthorized',
      body: { error: 'Bad token' },
    }));

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      catch: async ({ retry }) => retry(),
    });

    try {
      await api
        .url('/api/always-fails')
        .schema(createMockSchema<User>({ id: '', name: '', email: '' }))
        .run('GET');
      expect.fail('should have thrown on second failure');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      if (fe.type === 'http') {
        expect(fe.status).toBe(401);
      }
    }
  });

  it('retry merges new headers with existing ones', async () => {
    let callCount = 0;
    const capturedHeaders: Record<string, string>[] = [];
    const userPayload: User = { id: '1', name: 'Test', email: 'test@example.com' };

    const server = createFakeApi();
    server.get('/api/data', ({ headers }) => {
      capturedHeaders.push({ ...headers });
      callCount++;
      if (callCount === 1) {
        return {
          status: 401,
          statusText: 'Unauthorized',
          body: { error: 'Expired' },
        };
      }
      return { status: 200, statusText: 'OK', body: userPayload };
    });

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      headers: { 'X-Custom': 'keep-me' },
    });

    const user = await api
      .url('/api/data')
      .schema(createMockSchema<User>(userPayload))
      .headers({ Authorization: 'Bearer old' })
      .catch(async ({ error, retry }) => {
        if (error.type === 'http' && error.status === 401) {
          return retry({ headers: { Authorization: 'Bearer new' } });
        }
      })
      .run('GET');

    expect(user.id).toBe('1');
    expect(capturedHeaders[1]['X-Custom']).toBe('keep-me');
    expect(capturedHeaders[1]['Authorization']).toBe('Bearer new');
  });
});

describe('e2e: observability (onSpan)', () => {
  it('emits a span for every successful request', async () => {
    const server = createFakeApi();
    const payload: UserList = { users: [], total: 0 };

    server.get('/api/users', () => ({
      status: 200,
      statusText: 'OK',
      body: payload,
    }));

    const spans: SpanEvent[] = [];

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      onSpan: (s) => spans.push(s),
    });

    await api
      .url('/api/users')
      .schema(createMockSchema<UserList>(payload))
      .run('GET');

    expect(spans).toHaveLength(1);
    expect(spans[0].ok).toBe(true);
    expect(spans[0].status).toBe(200);
    expect(spans[0].method).toBe('GET');
    expect(spans[0].url).toBe('/api/users');
    expect(spans[0].op).toBe('query');
    expect(typeof spans[0].durationMs).toBe('number');
    expect(spans[0].error).toBeUndefined();
  });

  it('emits a span with error for failed requests', async () => {
    const server = createFakeApi();
    server.post('/api/users', () => ({
      status: 400,
      statusText: 'Bad Request',
      body: { error: 'Invalid data' },
    }));

    const spans: SpanEvent[] = [];

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      onSpan: (s) => spans.push(s),
    });

    try {
      await api.url('/api/users').body({ bad: 'data' }).run('POST');
    } catch {
      // expected
    }

    expect(spans).toHaveLength(1);
    expect(spans[0].ok).toBe(false);
    expect(spans[0].op).toBe('mutate');
    expect(spans[0].error).toBeDefined();
    expect(spans[0].error!.type).toBe('http');
  });

  it('emits a span for network errors', async () => {
    const spans: SpanEvent[] = [];

    const api = createComposableFetcher({
      fetchFn: createFailingFetch(),
      onSpan: (s) => spans.push(s),
    });

    try {
      await api.url('/api/test').run('GET');
    } catch {
      // expected
    }

    expect(spans).toHaveLength(1);
    expect(spans[0].ok).toBe(false);
    expect(spans[0].error!.type).toBe('network');
    expect(spans[0].status).toBeUndefined();
  });

  it('emits a span with custom name when .name() is used', async () => {
    const server = createFakeApi();
    const payload: UserList = { users: [], total: 0 };

    server.get('/api/users', () => ({
      status: 200,
      statusText: 'OK',
      body: payload,
    }));

    const spans: SpanEvent[] = [];
    const api = createComposableFetcher({
      fetchFn: server.fetch,
      onSpan: (s) => spans.push(s),
    });

    await api
      .url('/api/users')
      .schema(createMockSchema<UserList>(payload))
      .name('listUsers')
      .run('GET');

    expect(spans[0].name).toBe('listUsers');
  });
});

describe('e2e: header management', () => {
  it('always sends Accept: application/json', async () => {
    const server = createFakeApi();
    let capturedHeaders: Record<string, string> = {};

    server.get('/api/test', ({ headers }) => {
      capturedHeaders = { ...headers };
      return { status: 200, statusText: 'OK', body: {} };
    });

    const api = createComposableFetcher({ fetchFn: server.fetch });
    await api.url('/api/test').run('GET');

    expect(capturedHeaders['Accept']).toBe('application/json');
  });

  it('merges instance headers with per-request headers', async () => {
    const server = createFakeApi();
    let capturedHeaders: Record<string, string> = {};

    server.get('/api/test', ({ headers }) => {
      capturedHeaders = { ...headers };
      return { status: 200, statusText: 'OK', body: {} };
    });

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      headers: { Authorization: 'Bearer token', 'X-Instance': 'yes' },
    });

    await api
      .url('/api/test')
      .headers({ 'X-Request': 'yes' })
      .run('GET');

    expect(capturedHeaders['Authorization']).toBe('Bearer token');
    expect(capturedHeaders['X-Instance']).toBe('yes');
    expect(capturedHeaders['X-Request']).toBe('yes');
    expect(capturedHeaders['Accept']).toBe('application/json');
  });

  it('per-request headers override instance headers', async () => {
    const server = createFakeApi();
    let capturedHeaders: Record<string, string> = {};

    server.get('/api/test', ({ headers }) => {
      capturedHeaders = { ...headers };
      return { status: 200, statusText: 'OK', body: {} };
    });

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      headers: { Authorization: 'Bearer old' },
    });

    await api
      .url('/api/test')
      .headers({ Authorization: 'Bearer new' })
      .run('GET');

    expect(capturedHeaders['Authorization']).toBe('Bearer new');
  });
});

describe('e2e: configure() for derived instances', () => {
  it('creates a derived instance with merged config', async () => {
    const server = createFakeApi();
    let capturedHeaders: Record<string, string> = {};

    server.get('/api/data', ({ headers }) => {
      capturedHeaders = { ...headers };
      return {
        status: 200,
        statusText: 'OK',
        body: { id: '1', name: 'Test', email: 'test@test.com' },
      };
    });

    const base = createComposableFetcher({
      fetchFn: server.fetch,
      headers: { 'X-App': 'my-app' },
    });

    const authed = base.configure({
      headers: { Authorization: 'Bearer token123' },
    });

    await authed
      .url('/api/data')
      .schema(createMockSchema<User>({ id: '1', name: 'Test', email: 'test@test.com' }))
      .run('GET');

    // configure() shallow-merges, so X-App from base is overridden
    // because headers is replaced entirely at the config level
    expect(capturedHeaders['Authorization']).toBe('Bearer token123');
  });

  it('derived instance does not affect the original', async () => {
    const server = createFakeApi();
    const capturedHeaderSets: Record<string, string>[] = [];

    server.get('/api/data', ({ headers }) => {
      capturedHeaderSets.push({ ...headers });
      return { status: 200, statusText: 'OK', body: {} };
    });

    const base = createComposableFetcher({
      fetchFn: server.fetch,
      headers: { 'X-Base': 'yes' },
    });

    const derived = base.configure({
      headers: { 'X-Derived': 'yes' },
    });

    await base.url('/api/data').run('GET');
    await derived.url('/api/data').run('GET');

    expect(capturedHeaderSets[0]['X-Base']).toBe('yes');
    expect(capturedHeaderSets[0]['X-Derived']).toBeUndefined();
    expect(capturedHeaderSets[1]['X-Derived']).toBe('yes');
  });
});

describe('e2e: global error handling config', () => {
  it('global errorSchema + errorMessage applies to all requests', async () => {
    const server = createFakeApi();
    server.get('/api/a', () => ({
      status: 400,
      statusText: 'Bad Request',
      body: { code: 'ERR_A', message: 'Error A happened' },
    }));
    server.get('/api/b', () => ({
      status: 422,
      statusText: 'Unprocessable',
      body: { code: 'ERR_B', message: 'Error B happened' },
    }));

    const errors: string[] = [];

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      errorSchema: createMockSchema<ApiError>({ code: '', message: '' }),
      errorMessage: (data) => (data as ApiError).message,
      catch: ({ error }) => {
        errors.push(error.message);
      },
    });

    await api.url('/api/a').run('GET');
    await api.url('/api/b').run('GET');

    expect(errors).toEqual(['Error A happened', 'Error B happened']);
  });

  it('per-request errorSchema overrides global one', async () => {
    const violationsPayload: ValidationError = {
      violations: [{ field: 'email', message: 'invalid' }],
    };

    const server = createFakeApi();
    server.post('/api/validate', () => ({
      status: 422,
      statusText: 'Unprocessable Entity',
      body: violationsPayload,
    }));

    let capturedMessage = '';

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      errorSchema: createMockSchema<ApiError>({ code: '', message: '' }),
      errorMessage: (data) => (data as ApiError).message,
    });

    await api
      .url('/api/validate')
      .body({ email: 'bad' })
      .errorSchema(
        createMockSchema<ValidationError>(violationsPayload),
        (data) => data.violations.map((v: { field: string; message: string }) => v.message).join(', '),
      )
      .catch(({ error }) => {
        capturedMessage = error.message;
      })
      .run('POST');

    expect(capturedMessage).toBe('invalid');
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

describe('e2e: real-world scenarios', () => {
  it('CRUD workflow: create, read, update, delete', async () => {
    const server = createFakeApi();
    const db: Record<string, User> = {};

    server.post('/api/users', ({ body }) => {
      const b = body as { name: string; email: string };
      const id = String(Object.keys(db).length + 1);
      db[id] = { id, name: b.name, email: b.email };
      return { status: 201, statusText: 'Created', body: db[id] };
    });

    server.get('/api/users/1', () => {
      if (!db['1'])
        return { status: 404, statusText: 'Not Found', body: { error: 'Not found' } };
      return { status: 200, statusText: 'OK', body: db['1'] };
    });

    server.put('/api/users/1', ({ body }) => {
      if (!db['1'])
        return { status: 404, statusText: 'Not Found', body: { error: 'Not found' } };
      const b = body as { name: string; email: string };
      db['1'] = { ...db['1'], name: b.name, email: b.email };
      return { status: 200, statusText: 'OK', body: db['1'] };
    });

    server.delete('/api/users/1', () => {
      delete db['1'];
      return { status: 204, statusText: 'No Content', body: null };
    });

    const api = createComposableFetcher({ fetchFn: server.fetch });
    const userSchema = createMockSchema<User>({ id: '', name: '', email: '' });

    // Create
    const created = await api
      .url('/api/users')
      .schema(userSchema)
      .body({ name: 'Alice', email: 'alice@example.com' })
      .run('POST');
    expect(created.id).toBe('1');

    // Read
    const read = await api.url('/api/users/1').schema(userSchema).run('GET');
    expect(read.name).toBe('Alice');

    // Update
    const updated = await api
      .url('/api/users/1')
      .schema(userSchema)
      .body({ name: 'Alice Updated', email: 'alice-new@example.com' })
      .run('PUT');
    expect(updated.name).toBe('Alice Updated');

    // Delete
    const deleteResult = await api.url('/api/users/1').run('DELETE');
    expect(deleteResult).toBeUndefined();

    // Verify deleted
    try {
      await api.url('/api/users/1').schema(userSchema).run('GET');
      expect.fail('should have thrown 404');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      if (fe.type === 'http') expect(fe.status).toBe(404);
    }
  });

  it('JWT refresh flow: expired token -> refresh -> retry succeeds', async () => {
    let currentToken = 'expired-token';
    const userPayload: User = { id: '1', name: 'Protected User', email: 'user@example.com' };

    const server = createFakeApi();
    server.get('/api/protected', ({ headers }) => {
      if (headers['Authorization'] !== 'Bearer fresh-token') {
        return {
          status: 401,
          statusText: 'Unauthorized',
          body: { error: 'Token expired' },
        };
      }
      return { status: 200, statusText: 'OK', body: userPayload };
    });

    // Simulate token refresh
    async function refreshToken(): Promise<string> {
      await new Promise((r) => setTimeout(r, 5));
      return 'fresh-token';
    }

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      headers: { Authorization: `Bearer ${currentToken}` },
      catch: async ({ error, retry }) => {
        if (error.type === 'http' && error.status === 401) {
          const newToken = await refreshToken();
          currentToken = newToken;
          return retry({ headers: { Authorization: `Bearer ${newToken}` } });
        }
      },
    });

    const user = await api
      .url('/api/protected')
      .schema(createMockSchema<User>(userPayload))
      .run('GET');

    expect(user.name).toBe('Protected User');
    expect(currentToken).toBe('fresh-token');
  });

  it('error reporting: collect errors from multiple failing requests', async () => {
    const server = createFakeApi();
    server.get('/api/fail-1', () => ({
      status: 500,
      statusText: 'ISE',
      body: { error: 'Database down' },
    }));
    server.get('/api/fail-2', () => ({
      status: 503,
      statusText: 'Service Unavailable',
      body: { error: 'Redis timeout' },
    }));

    const errorLog: Array<{ url: string; error: FetchError }> = [];

    const api = createComposableFetcher({
      fetchFn: server.fetch,
      onSpan: (span) => {
        if (!span.ok && span.error) {
          errorLog.push({ url: span.url, error: span.error });
        }
      },
      catch: () => {
        // swallow all errors
      },
    });

    await api.url('/api/fail-1').run('GET');
    await api.url('/api/fail-2').run('GET');

    expect(errorLog).toHaveLength(2);
    expect(errorLog[0].url).toBe('/api/fail-1');
    expect(errorLog[0].error.type).toBe('http');
    expect(errorLog[1].url).toBe('/api/fail-2');
    expect(errorLog[1].error.message).toBe('Redis timeout');
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

  it('handles request to unregistered route (404 from fake server)', async () => {
    const server = createFakeApi();
    // No routes registered

    const api = createComposableFetcher({ fetchFn: server.fetch });

    try {
      await api
        .url('/api/nonexistent')
        .schema(createMockSchema<User>({ id: '', name: '', email: '' }))
        .run('GET');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      if (fe.type === 'http') {
        expect(fe.status).toBe(404);
      }
    }
  });
});

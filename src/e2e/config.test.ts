import { describe, it, expect } from 'vitest';
import { createComposableFetcher } from '../index.js';
import type { FetchError, SpanEvent } from '../index.js';
import { createMockSchema } from '../functions/composable-fetcher.functions.mock.js';
import { createFakeApi, createFailingFetch } from './index.js';

type User = { id: string; name: string; email: string };
type UserList = { users: User[]; total: number };
type ApiError = { code: string; message: string };
type ValidationError = {
  violations: Array<{ field: string; message: string }>;
};

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

    await api.url('/api/test').headers({ 'X-Request': 'yes' }).run('GET');

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
        (data) =>
          data.violations
            .map((v: { field: string; message: string }) => v.message)
            .join(', '),
      )
      .catch(({ error }) => {
        capturedMessage = error.message;
      })
      .run('POST');

    expect(capturedMessage).toBe('invalid');
  });
});

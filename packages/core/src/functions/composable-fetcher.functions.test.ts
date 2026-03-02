import { describe, it, expect, vi } from 'vitest';
import type { FetchError, SpanEvent } from '../entity/composable-fetcher.interfaces.js';
import { createComposableFetcher } from '../composable-fetcher.js';
import { createComposableFetcherFunctions } from './composable-fetcher.functions.js';
import {
  createComposableFetcherDependenciesMock,
  createFailingMockSchema,
  createMockSchema,
  mockFetchNetworkError,
  mockFetchResponse,
} from './composable-fetcher.functions.mock.js';

function createTestSetup(
  overrides?: Parameters<typeof createComposableFetcherDependenciesMock>[0],
) {
  const fetchMock = vi.fn();
  const deps = createComposableFetcherDependenciesMock({
    fetch: fetchMock,
    ...overrides,
  });
  const fns = createComposableFetcherFunctions(deps);
  return { fetchMock, deps, fns };
}

describe('execute success', () => {
  it('returns parsed data on success', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock, { body: { id: '1' } });

    const result = await fns.execute({
      url: '/api/test',
      method: 'GET',
      op: 'query',
      name: 'test',
      fallback: 'failed',
      headers: {},
      schema: createMockSchema({ id: '1' }),
    });

    expect(result).toEqual({ id: '1' });
  });

  it('returns undefined when no schema (void mutation)', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock);

    const result = await fns.execute({
      url: '/api/test',
      method: 'POST',
      op: 'mutate',
      name: 'test',
      fallback: 'failed',
      headers: {},
    });

    expect(result).toBeUndefined();
  });

  it('sends body as JSON string', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock);

    await fns.execute({
      url: '/api/test',
      method: 'POST',
      op: 'mutate',
      name: 'test',
      fallback: 'failed',
      headers: {},
      body: { email: 'a@b.com' },
    });

    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"email":"a@b.com"}');
  });
});

describe('execute errors', () => {
  it('throws FetchError.network on network failure', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchNetworkError(fetchMock);

    try {
      await fns.execute({
        url: '/api/test',
        method: 'GET',
        op: 'query',
        name: 'test',
        fallback: 'failed',
        headers: {},
      });
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('network');
    }
  });

  it('throws FetchError.http with default error body decoding', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock, {
      status: 403,
      statusText: 'Forbidden',
      body: { error: 'Not allowed' },
    });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'GET',
        op: 'query',
        name: 'test',
        fallback: 'fallback msg',
        headers: {},
      });
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      expect(fe.message).toBe('Not allowed');
    }
  });

  it('uses fallback when server provides no recognizable error body', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock, { status: 500, statusText: 'ISE', body: {} });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'GET',
        op: 'query',
        name: 'test',
        fallback: 'Something went wrong',
        headers: {},
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe('Something went wrong');
    }
  });

  it('throws FetchError.parse when schema validation fails', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock, { body: { bad: 'data' } });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'GET',
        op: 'query',
        name: 'test',
        fallback: 'failed',
        headers: {},
        schema: createFailingMockSchema('expected string'),
      });
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('parse');
      if (fe.type === 'parse') {
        expect(fe.issues).toEqual(['expected string']);
      }
    }
  });
});

describe('execute errorSchema', () => {
  it('decodes error body with custom errorSchema and errorMessage', async () => {
    const violationSchema = createMockSchema({
      violations: [{ propertyPath: 'email', message: 'invalid email' }],
    });

    const { fetchMock, fns } = createTestSetup({
      errorSchema: violationSchema,
      errorMessage: vi.fn((data: unknown) => {
        const d = data as { violations: Array<{ message: string }> };
        return d.violations.map((v) => v.message).join(', ');
      }),
    });

    mockFetchResponse(fetchMock, {
      status: 422,
      statusText: 'Unprocessable Entity',
      body: {
        violations: [{ propertyPath: 'email', message: 'invalid email' }],
      },
    });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'POST',
        op: 'mutate',
        name: 'test',
        fallback: 'Validation failed',
        headers: {},
      });
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      if (fe.type === 'http') {
        expect(fe.message).toBe('invalid email');
        expect(fe.data).toEqual({
          violations: [{ propertyPath: 'email', message: 'invalid email' }],
        });
      }
    }
  });

  it('uses fallback when errorSchema does not match', async () => {
    const { fetchMock, fns } = createTestSetup({
      errorSchema: createFailingMockSchema('not matching'),
    });

    mockFetchResponse(fetchMock, {
      status: 400,
      statusText: 'Bad Request',
      body: { something: 'unexpected' },
    });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'POST',
        op: 'mutate',
        name: 'test',
        fallback: 'Request failed',
        headers: {},
      });
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('http');
      expect(fe.message).toBe('Request failed');
      if (fe.type === 'http') {
        expect(fe.data).toBeUndefined();
      }
    }
  });

  it('per-request errorSchema overrides dependency-level', async () => {
    const depSchema = createMockSchema({ error: 'dep-level' });
    const reqSchema = createMockSchema({ detail: 'req-level' });

    const { fetchMock, fns } = createTestSetup({
      errorSchema: depSchema,
      errorMessage: vi.fn(() => 'from deps'),
    });

    mockFetchResponse(fetchMock, {
      status: 400,
      statusText: 'Bad Request',
      body: { detail: 'req-level' },
    });

    const reqMessageExtractor = vi.fn(
      (data: unknown) => (data as { detail: string }).detail,
    );

    try {
      await fns.execute({
        url: '/api/test',
        method: 'POST',
        op: 'mutate',
        name: 'test',
        fallback: 'fallback',
        headers: {},
        errorSchema: reqSchema,
        errorMessage: reqMessageExtractor,
      });
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.message).toBe('req-level');
      expect(reqMessageExtractor).toHaveBeenCalled();
    }
  });
});

describe('execute observability', () => {
  it('emits span on success', async () => {
    const onSpan = vi.fn();
    const { fetchMock, fns } = createTestSetup({ onSpan });
    mockFetchResponse(fetchMock, { status: 200 });

    await fns.execute({
      url: '/api/test',
      method: 'GET',
      op: 'query',
      name: 'getTest',
      fallback: 'failed',
      headers: {},
    });

    expect(onSpan).toHaveBeenCalledTimes(1);
    const span: SpanEvent = onSpan.mock.calls[0][0];
    expect(span.ok).toBe(true);
    expect(span.name).toBe('getTest');
    expect(span.op).toBe('query');
    expect(span.status).toBe(200);
    expect(typeof span.durationMs).toBe('number');
  });

  it('emits span with error on failure', async () => {
    const onSpan = vi.fn();
    const { fetchMock, fns } = createTestSetup({ onSpan });
    mockFetchResponse(fetchMock, {
      status: 401,
      statusText: 'Unauthorized',
      body: {},
    });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'POST',
        op: 'mutate',
        name: 'doThing',
        fallback: 'failed',
        headers: {},
      });
    } catch {
      // expected
    }

    expect(onSpan).toHaveBeenCalledTimes(1);
    const span: SpanEvent = onSpan.mock.calls[0][0];
    expect(span.ok).toBe(false);
    expect(span.error?.type).toBe('http');
  });
});

describe('execute catch', () => {
  it('calls catch handler on http error', async () => {
    const catchHandler = vi.fn();
    const { fetchMock, fns } = createTestSetup({ catch: catchHandler });
    mockFetchResponse(fetchMock, {
      status: 401,
      statusText: 'Unauthorized',
      body: {},
    });

    await fns.execute({
      url: '/api/test',
      method: 'GET',
      op: 'query',
      name: 'test',
      fallback: 'failed',
      headers: {},
    });

    expect(catchHandler).toHaveBeenCalledTimes(1);
    const error: FetchError = catchHandler.mock.calls[0][0].error;
    expect(error.type).toBe('http');
  });

  it('retries with new headers on 401', async () => {
    const fetchMock = vi.fn();
    const catchHandler = vi.fn(
      async ({
        error,
        retry,
      }: {
        error: FetchError;
        retry: (opts?: {
          headers?: Record<string, string>;
        }) => Promise<unknown>;
      }) => {
        if (error.type === 'http' && error.status === 401) {
          return retry({ headers: { Authorization: 'Bearer new-token' } });
        }
      },
    );

    const deps = createComposableFetcherDependenciesMock({
      fetch: fetchMock,
      catch: catchHandler,
    });
    const fns = createComposableFetcherFunctions(deps);

    // First: 401, second (retry): 200
    mockFetchResponse(fetchMock, {
      status: 401,
      statusText: 'Unauthorized',
      body: {},
    });
    mockFetchResponse(fetchMock, { body: { users: [] } });

    const result = await fns.execute({
      url: '/api/test',
      method: 'GET',
      op: 'query',
      name: 'test',
      fallback: 'failed',
      headers: { Authorization: 'Bearer old-token' },
      schema: createMockSchema({ users: [] }),
    });

    expect(result).toEqual({ users: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryHeaders = fetchMock.mock.calls[1][1]?.headers as Record<
      string,
      string
    >;
    expect(retryHeaders.Authorization).toBe('Bearer new-token');
  });

  it('does not retry more than once (prevents infinite loop)', async () => {
    const fetchMock = vi.fn();
    const catchHandler = vi.fn(
      async ({ retry }: { retry: () => Promise<unknown> }) => retry(),
    );

    const deps = createComposableFetcherDependenciesMock({
      fetch: fetchMock,
      catch: catchHandler,
    });
    const fns = createComposableFetcherFunctions(deps);

    mockFetchResponse(fetchMock, {
      status: 401,
      statusText: 'Unauthorized',
      body: {},
    });
    mockFetchResponse(fetchMock, {
      status: 401,
      statusText: 'Unauthorized',
      body: {},
    });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'GET',
        op: 'query',
        name: 'test',
        fallback: 'failed',
        headers: {},
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error & { fetchError: FetchError }).fetchError.type).toBe(
        'http',
      );
    }

    expect(catchHandler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('swallows error when catch handler returns undefined', async () => {
    const catchHandler = vi.fn(); // returns undefined
    const { fetchMock, fns } = createTestSetup({ catch: catchHandler });
    mockFetchResponse(fetchMock, { status: 500, statusText: 'ISE', body: {} });

    const result = await fns.execute({
      url: '/api/test',
      method: 'GET',
      op: 'query',
      name: 'test',
      fallback: 'server error',
      headers: {},
    });

    expect(result).toBeUndefined();
    expect(catchHandler).toHaveBeenCalledTimes(1);
  });

  it('calls catch handler for network errors', async () => {
    const catchHandler = vi.fn();
    const { fetchMock, fns } = createTestSetup({ catch: catchHandler });
    mockFetchNetworkError(fetchMock);

    await fns.execute({
      url: '/api/test',
      method: 'GET',
      op: 'query',
      name: 'test',
      fallback: 'failed',
      headers: {},
    });

    expect(catchHandler).toHaveBeenCalledTimes(1);
    expect(catchHandler.mock.calls[0][0].error.type).toBe('network');
  });

  it('per-request catch overrides dependency-level', async () => {
    const depCatch = vi.fn();
    const reqCatch = vi.fn();
    const { fetchMock, fns } = createTestSetup({ catch: depCatch });
    mockFetchResponse(fetchMock, {
      status: 400,
      statusText: 'Bad Request',
      body: {},
    });

    await fns.execute({
      url: '/api/test',
      method: 'GET',
      op: 'query',
      name: 'test',
      fallback: 'failed',
      headers: {},
      catch: reqCatch,
    });

    expect(reqCatch).toHaveBeenCalledTimes(1);
    expect(depCatch).not.toHaveBeenCalled();
  });
});

describe('execute input validation', () => {
  it('validates body against inputSchema before sending', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock, { body: { id: '1' } });

    await fns.execute({
      url: '/api/test',
      method: 'POST',
      op: 'mutate',
      name: 'test',
      fallback: 'failed',
      headers: {},
      body: { email: 'a@b.com' },
      inputSchema: createMockSchema({ email: 'a@b.com' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"email":"a@b.com"}');
  });

  it('throws FetchError.input when inputSchema validation fails', async () => {
    const { fetchMock, fns } = createTestSetup();

    try {
      await fns.execute({
        url: '/api/test',
        method: 'POST',
        op: 'mutate',
        name: 'test',
        fallback: 'failed',
        headers: {},
        body: { email: 'bad' },
        inputSchema: createFailingMockSchema('email must be valid'),
      });
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('input');
      if (fe.type === 'input') {
        expect(fe.message).toBe('Invalid input');
        expect(fe.issues).toEqual(['email must be valid']);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes input validation errors through catch handler', async () => {
    const catchHandler = vi.fn();
    const { fetchMock, fns } = createTestSetup({ catch: catchHandler });

    await fns.execute({
      url: '/api/test',
      method: 'POST',
      op: 'mutate',
      name: 'test',
      fallback: 'failed',
      headers: {},
      body: { bad: 'data' },
      inputSchema: createFailingMockSchema('invalid field'),
    });

    expect(catchHandler).toHaveBeenCalledTimes(1);
    const error: FetchError = catchHandler.mock.calls[0][0].error;
    expect(error.type).toBe('input');
    if (error.type === 'input') {
      expect(error.issues).toEqual(['invalid field']);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the validated (transformed) value as the body', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock);

    const transformingSchema = {
      '~standard': {
        version: 1 as const,
        validate: (value: unknown) => ({
          value: { ...(value as Record<string, unknown>), extra: 'added' },
        }),
      },
    };

    await fns.execute({
      url: '/api/test',
      method: 'POST',
      op: 'mutate',
      name: 'test',
      fallback: 'failed',
      headers: {},
      body: { name: 'John' },
      inputSchema: transformingSchema,
    });

    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      '{"name":"John","extra":"added"}',
    );
  });

  it('skips input validation when no inputSchema is provided', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock);

    await fns.execute({
      url: '/api/test',
      method: 'POST',
      op: 'mutate',
      name: 'test',
      fallback: 'failed',
      headers: {},
      body: { anything: 'goes' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips input validation when body is undefined', async () => {
    const { fetchMock, fns } = createTestSetup();
    mockFetchResponse(fetchMock);

    await fns.execute({
      url: '/api/test',
      method: 'POST',
      op: 'mutate',
      name: 'test',
      fallback: 'failed',
      headers: {},
      inputSchema: createFailingMockSchema('should not trigger'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('emits span with error on input validation failure', async () => {
    const onSpan = vi.fn();
    const { fetchMock, fns } = createTestSetup({ onSpan });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'POST',
        op: 'mutate',
        name: 'createUser',
        fallback: 'failed',
        headers: {},
        body: { bad: 'data' },
        inputSchema: createFailingMockSchema('name is required'),
      });
    } catch {
      // expected
    }

    expect(onSpan).toHaveBeenCalledTimes(1);
    const span: SpanEvent = onSpan.mock.calls[0][0];
    expect(span.ok).toBe(false);
    expect(span.error?.type).toBe('input');
  });
});

describe('builder .input()', () => {
  it('validates body before sending on mutation', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchResponse(fetchMock, { body: { id: '1' } });

    const result = await api
      .url('/api/users')
      .input(createMockSchema({ name: 'John' }))
      .body({ name: 'John' })
      .schema(createMockSchema({ id: '1' }))
      .run('POST');

    expect(result).toEqual({ id: '1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"name":"John"}');
  });

  it('throws input error when body fails input schema validation', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    try {
      await api
        .url('/api/users')
        .input(createFailingMockSchema('email is required'))
        .body({ name: 'John' })
        .run('POST');
      expect.fail('should have thrown');
    } catch (err) {
      const fe = (err as Error & { fetchError: FetchError }).fetchError;
      expect(fe.type).toBe('input');
      if (fe.type === 'input') {
        expect(fe.issues).toEqual(['email is required']);
      }
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes input errors through builder .catch() handler', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    const handler = vi.fn();

    await api
      .url('/api/users')
      .input(createFailingMockSchema('bad input'))
      .body({ invalid: true })
      .catch(handler)
      .run('POST');

    expect(handler).toHaveBeenCalledTimes(1);
    const error: FetchError = handler.mock.calls[0][0].error;
    expect(error.type).toBe('input');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not validate body when no .input() is used (backwards compatible)', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchResponse(fetchMock);

    await api.url('/api/users').body({ anything: 'goes' }).run('POST');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('builder .catch()', () => {
  it('catches http errors and passes typed FetchError to handler', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchResponse(fetchMock, {
      status: 422,
      statusText: 'Unprocessable Entity',
      body: { error: 'Validation failed' },
    });

    const handler = vi.fn();

    await api
      .url('/api/users')
      .body({ email: 'bad' })
      .catch(handler)
      .run('POST');

    expect(handler).toHaveBeenCalledTimes(1);
    const error: FetchError = handler.mock.calls[0][0].error;
    expect(error.type).toBe('http');
    if (error.type === 'http') {
      expect(error.status).toBe(422);
      expect(error.message).toBe('Validation failed');
    }
  });

  it('catches network errors and passes them to handler', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchNetworkError(fetchMock);

    const handler = vi.fn();

    await api
      .url('/api/users')
      .catch(handler)
      .run('GET');

    expect(handler).toHaveBeenCalledTimes(1);
    const error: FetchError = handler.mock.calls[0][0].error;
    expect(error.type).toBe('network');
  });

  it('resolves to undefined when catch handler swallows error', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchResponse(fetchMock, {
      status: 500,
      statusText: 'ISE',
      body: {},
    });

    const result = await api
      .url('/api/test')
      .catch(() => {})
      .run('GET');

    expect(result).toBeUndefined();
  });

  it('does not interfere with successful requests', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchResponse(fetchMock, { body: { id: '1' } });

    const handler = vi.fn();

    const result = await api
      .url('/api/test')
      .schema(createMockSchema({ id: '1' }))
      .catch(handler)
      .run('GET');

    expect(result).toEqual({ id: '1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('works with errorSchema providing typed error data', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    const violationsBody = {
      violations: [{ propertyPath: 'email', message: 'invalid email' }],
    };

    mockFetchResponse(fetchMock, {
      status: 422,
      statusText: 'Unprocessable Entity',
      body: violationsBody,
    });

    const violationsSchema = createMockSchema(violationsBody);

    let capturedData: unknown;

    await api
      .url('/api/users')
      .body({ email: 'bad' })
      .errorSchema(violationsSchema, (data) =>
        data.violations.map((v) => v.message).join(', '),
      )
      .catch(({ error }) => {
        if (error.type === 'http') {
          capturedData = error.data;
        }
      })
      .run('POST');

    expect(capturedData).toEqual(violationsBody);
  });

  it('supports async catch handlers', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchResponse(fetchMock, {
      status: 400,
      statusText: 'Bad Request',
      body: { error: 'oops' },
    });

    let asyncResolved = false;

    await api
      .url('/api/test')
      .catch(async () => {
        await new Promise((r) => setTimeout(r, 10));
        asyncResolved = true;
      })
      .run('GET');

    expect(asyncResolved).toBe(true);
  });

  it('retries via builder .catch()', async () => {
    const fetchMock = vi.fn();
    const api = createComposableFetcher({ fetchFn: fetchMock });

    mockFetchResponse(fetchMock, {
      status: 401,
      statusText: 'Unauthorized',
      body: {},
    });
    mockFetchResponse(fetchMock, { body: { ok: true } });

    const result = await api
      .url('/api/test')
      .schema(createMockSchema({ ok: true }))
      .catch(async ({ error, retry }) => {
        if (error.type === 'http' && error.status === 401) {
          return retry({ headers: { Authorization: 'Bearer refreshed' } });
        }
      })
      .run('GET');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { FetchError, SpanEvent } from './types.js';
import { createComposableFetcherFunctions } from './functions.js';
import {
  createComposableFetcherDependenciesMock,
  createFailingMockSchema,
  createMockSchema,
  mockFetchNetworkError,
  mockFetchResponse,
} from './testing.js';

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

describe('execute onError', () => {
  it('calls onError handler on http error', async () => {
    const onError = vi.fn();
    const { fetchMock, fns } = createTestSetup({ onError });
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
    } catch {
      // expected
    }

    expect(onError).toHaveBeenCalledTimes(1);
    const error: FetchError = onError.mock.calls[0][0];
    expect(error.type).toBe('http');
  });

  it('retries with new headers on 401', async () => {
    const fetchMock = vi.fn();
    const onError = vi.fn(
      async (
        error: FetchError,
        retry: (opts?: {
          headers?: Record<string, string>;
        }) => Promise<unknown>,
      ) => {
        if (error.type === 'http' && error.status === 401) {
          return retry({ headers: { Authorization: 'Bearer new-token' } });
        }
      },
    );

    const deps = createComposableFetcherDependenciesMock({
      fetch: fetchMock,
      onError,
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
    const onError = vi.fn(
      async (_e: FetchError, retry: () => Promise<unknown>) => retry(),
    );

    const deps = createComposableFetcherDependenciesMock({
      fetch: fetchMock,
      onError,
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

    expect(onError).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates error when onError returns undefined', async () => {
    const onError = vi.fn(); // returns undefined
    const { fetchMock, fns } = createTestSetup({ onError });
    mockFetchResponse(fetchMock, { status: 500, statusText: 'ISE', body: {} });

    try {
      await fns.execute({
        url: '/api/test',
        method: 'GET',
        op: 'query',
        name: 'test',
        fallback: 'server error',
        headers: {},
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe('server error');
    }

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('calls onError for network errors', async () => {
    const onError = vi.fn();
    const { fetchMock, fns } = createTestSetup({ onError });
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
    } catch {
      // expected
    }

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].type).toBe('network');
  });

  it('per-request onError overrides dependency-level', async () => {
    const depOnError = vi.fn();
    const reqOnError = vi.fn();
    const { fetchMock, fns } = createTestSetup({ onError: depOnError });
    mockFetchResponse(fetchMock, {
      status: 400,
      statusText: 'Bad Request',
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
        onError: reqOnError,
      });
    } catch {
      // expected
    }

    expect(reqOnError).toHaveBeenCalledTimes(1);
    expect(depOnError).not.toHaveBeenCalled();
  });
});

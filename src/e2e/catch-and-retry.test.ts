import { describe, it, expect, vi } from 'vitest';
import { createComposableFetcher } from '../index.js';
import type { FetchError } from '../index.js';
import { createMockSchema } from '../functions/composable-fetcher.functions.mock.js';
import { createFakeApi } from './index.js';

type User = { id: string; name: string; email: string };
type UserList = { users: User[]; total: number };

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

    await api.url('/api/test').catch(requestCatch).run('GET');

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

import { describe, it, expect } from 'vitest';
import { createComposableFetcher } from '../index.js';
import type { FetchError } from '../index.js';
import { createMockSchema } from '../functions/composable-fetcher.functions.mock.js';
import { createFakeApi } from './index.js';

type User = { id: string; name: string; email: string };

describe('e2e: CRUD workflow', () => {
  it('create, read, update, delete a user', async () => {
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
});

describe('e2e: JWT refresh flow', () => {
  it('expired token -> refresh -> retry succeeds', async () => {
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
});

describe('e2e: error reporting', () => {
  it('collects errors from multiple failing requests via onSpan', async () => {
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
});

describe('e2e: edge cases', () => {
  it('handles request to unregistered route (404 from fake server)', async () => {
    const server = createFakeApi();

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

import { describe, it, expect } from 'vitest';
import { createComposableFetcher } from '../index.js';
import type { FetchError } from '../index.js';
import {
  createMockSchema,
  createFailingMockSchema,
} from '../functions/composable-fetcher.functions.mock.js';
import { createFakeApi } from './index.js';

type User = { id: string; name: string; email: string };
type UserList = { users: User[]; total: number };

describe('e2e: GET requests', () => {
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
      body: { items: [] },
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
        body: { id: '1', name: 'Patched', email: 'original@example.com' },
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

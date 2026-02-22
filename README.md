<p align="center">
  <img src="art/composable-fetcher-logo.png" alt="Composable Fetcher" />
</p>

Builder-based HTTP fetcher with Standard Schema validation, typed error decoding, retry, and observability.

- Zero dependencies — native `fetch`
- Standard Schema v1 (Zod, Valibot, ArkType, etc.)
- Full type inference from schema to response
- Inline error handling with retry
- Observability via span events

## Install

```bash
npm install @darna-digital/composable-fetcher
```

## Quick start

```ts
import { composableFetcher } from '@darna-digital/composable-fetcher';
import { z } from 'zod';

const UsersSchema = z.array(z.object({ id: z.string(), name: z.string() }));

// GET with response validation
const users = await composableFetcher
  .url('/api/users')
  .schema(UsersSchema)
  .run('GET');

// POST (void mutation)
await composableFetcher
  .url('/api/users')
  .body({ email: 'foo@bar.com' })
  .run('POST');
```

## Builder API

```ts
composableFetcher
  .url(url)                          // target URL
  .schema(schema)                    // response validation (Standard Schema)
  .errorSchema(schema, extractor?)   // backend error body validation
  .name('getUsers')                  // span name, defaults to "METHOD /url"
  .fallback('Load failed')           // fallback error message
  .headers({ 'X-Key': '1' })        // per-request headers
  .body({ key: 'value' })           // body for mutations
  .catch(handler)                    // error handling with retry
  .run('GET');                       // executes the request, returns Promise<T>
```

## Custom instance

```ts
import { createComposableFetcher } from '@darna-digital/composable-fetcher';

const api = createComposableFetcher({
  fetchFn: customFetch,
  headers: { 'X-App': '1.0' },
  credentials: 'include',
  cache: 'no-store',
  onSpan: (event) => log(event),
  catch: globalCatchHandler,
  errorSchema: BackendErrorSchema,
  errorMessage: (data) => extractMessage(data),
});

// Derive from existing
const adminApi = api.configure({ headers: { 'X-Role': 'admin' } });
```

| Option         | Type                         | Default            |
| -------------- | ---------------------------- | ------------------ |
| `fetchFn`      | `typeof fetch`               | `globalThis.fetch` |
| `headers`      | `Record<string, string>`     | `{}`               |
| `credentials`  | `RequestCredentials`         | `'include'`        |
| `cache`        | `RequestCache`               | `'no-store'`       |
| `onSpan`       | `(event: SpanEvent) => void` | —                  |
| `catch`        | `CatchHandler`               | —                  |
| `errorSchema`  | `StandardSchema`             | —                  |
| `errorMessage` | `(data: unknown) => string`  | —                  |

## Error handling

`.catch()` handles errors inline. The handler receives `{ error, retry }`.

```ts
type CatchHandler<E> = (params: {
  error: FetchError<E>;
  retry: (options?: { headers?: Record<string, string> }) => Promise<unknown>;
}) => Promise<unknown> | void;
```

- Return nothing — error is swallowed, promise resolves to `undefined`
- Return `retry()` — request is retried transparently (once per request)
- No `.catch()` — errors throw as normal

Set at config level (global) or builder level (per-request). Builder overrides config.

### Handling validation errors

When `errorSchema` is set, `error.data` is fully typed — no casting.

```ts
await api
  .url('/api/users')
  .body({ email, name })
  .errorSchema(ViolationsSchema)
  .catch(({ error }) => {
    if (error.type === 'http' && error.data) {
      for (const v of error.data.violations) {
        form.setError(v.propertyPath, { message: v.message });
      }
    }
  })
  .run('POST');
```

### JWT refresh

```ts
const api = createComposableFetcher({
  headers: { Authorization: `Bearer ${getAccessToken()}` },
  catch: async ({ error, retry }) => {
    if (error.type !== 'http' || error.status !== 401) return;
    const { accessToken } = await refreshAccessToken();
    setAccessToken(accessToken);
    return retry({ headers: { Authorization: `Bearer ${accessToken}` } });
  },
});
```

## Error types

Discriminated union — narrow on `type`:

```ts
type NetworkError = { type: 'network'; message: string };
type HttpError<D> = { type: 'http'; status: number; statusText: string; message: string; data?: D };
type ParseError   = { type: 'parse'; message: string; issues: string[] };
type FetchError<D> = NetworkError | HttpError<D> | ParseError;
```

`D` defaults to `unknown`. When `errorSchema` is set, `D` is inferred from the schema.

## Backend error schemas

Different backends return different error shapes. `errorSchema` decodes them with type safety.

```ts
// Symfony
const api = createComposableFetcher({
  errorSchema: z.object({
    violations: z.array(z.object({
      propertyPath: z.string(),
      message: z.string(),
    })),
  }),
  errorMessage: (data) => data.violations.map(v => v.message).join(', '),
});

// Laravel
const api = createComposableFetcher({
  errorSchema: z.object({
    errors: z.record(z.array(z.string())),
  }),
  errorMessage: (data) => Object.values(data.errors).flat().join(', '),
});
```

Per-request override:

```ts
await api
  .url('/api/external')
  .errorSchema(ExternalErrorSchema, (data) => data.detail)
  .run('POST');
```

## Headers

Merged in order (later wins):

1. Built-in (`Accept: application/json`, `Content-Type` for mutations)
2. Instance `headers`
3. Builder `.headers()`
4. Retry `headers`

## Observability

Every request emits a `SpanEvent`:

```ts
type SpanEvent = {
  name: string;
  op: 'query' | 'mutate';
  url: string;
  method: string;
  status?: number;
  durationMs: number;
  ok: boolean;
  error?: FetchError;
};
```

```ts
createComposableFetcher({
  onSpan: (event) => {
    Sentry.startSpan({ name: event.name, op: `http.${event.op}` }, (span) => {
      span.setAttribute('http.method', event.method);
      span.setAttribute('http.url', event.url);
      span.setAttribute('http.response_time_ms', event.durationMs);
      if (event.status) span.setAttribute('http.status_code', event.status);
      if (!event.ok) span.setStatus({ code: 2, message: event.error?.message });
    });
  },
});
```

## Testing

Test utilities from a separate entry point:

```ts
import {
  createComposableFetcherDependenciesMock,
  mockFetchResponse,
  mockFetchNetworkError,
  createMockSchema,
  createFailingMockSchema,
} from '@darna-digital/composable-fetcher/testing';
import { createComposableFetcherFunctions } from '@darna-digital/composable-fetcher';

const fetchMock = vi.fn();
const deps = createComposableFetcherDependenciesMock({ fetch: fetchMock });
const fns = createComposableFetcherFunctions(deps);

mockFetchResponse(fetchMock, { status: 200, body: { users: [] } });

const result = await fns.execute({
  url: '/api/users',
  method: 'GET',
  op: 'query',
  name: 'getUsers',
  fallback: 'failed',
  headers: {},
  schema: createMockSchema({ users: [] }),
});

expect(result).toEqual({ users: [] });
```

| Helper                                     | Description                        |
| ------------------------------------------ | ---------------------------------- |
| `createComposableFetcherDependenciesMock()` | Full dependencies mock             |
| `mockFetchResponse(fetchMock, config)`      | Queue a response                   |
| `mockFetchNetworkError(fetchMock)`          | Queue a network failure            |
| `createMockSchema<T>(output)`              | Schema that always succeeds        |
| `createFailingMockSchema(message)`         | Schema that always fails           |

## License

MIT

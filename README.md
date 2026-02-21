# @darna-digital/composable-fetcher

Builder-based HTTP fetcher with Standard Schema validation, typed backend error decoding, composable error handling with retry, and observability.

- Zero dependencies — uses native `fetch`
- Works with any Standard Schema v1 library (Zod, Valibot, ArkType, etc.)
- Full TypeScript inference from schema to response
- Composable error handling with single-retry guard
- Observability via structured span events
- Dependency injection for testability

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
  .url(url)                          // required — target URL
  .schema(schema)                    // optional — response validation (Standard Schema)
  .errorSchema(schema, extractor?)   // optional — backend error body validation
  .name('getUsers')                  // optional — span name, defaults to "METHOD /url"
  .fallback('Load failed')           // optional — fallback error message
  .headers({ 'X-Key': '1' })        // optional — per-request headers
  .body({ key: 'value' })           // optional — body for mutations
  .onError(handler)                  // optional — error handler with retry
  .run('GET');                       // finalizer — executes immediately, returns Promise<T>
```

`.run()` executes the request and returns `Promise<T>`. It infers `query` vs `mutate` operation type from the method.

## Custom instance

```ts
import { createComposableFetcher } from '@darna-digital/composable-fetcher';

const api = createComposableFetcher({
  fetchFn: customFetch,             // DI for testing / SSR
  headers: { 'X-App': '1.0' },
  credentials: 'include',
  cache: 'no-store',
  onSpan: (event) => log(event),
  onError: globalErrorHandler,
  errorSchema: BackendErrorSchema,
  errorMessage: (data) => extractMessage(data),
});
```

Derive from existing:

```ts
const adminApi = api.configure({ headers: { 'X-Role': 'admin' } });
```

### Config options

| Option         | Type                         | Default            | Description                        |
| -------------- | ---------------------------- | ------------------ | ---------------------------------- |
| `fetchFn`      | `typeof fetch`               | `globalThis.fetch` | Fetch implementation               |
| `headers`      | `Record<string, string>`     | `{}`               | Default headers                    |
| `credentials`  | `RequestCredentials`         | `'include'`        | Fetch credentials mode             |
| `cache`        | `RequestCache`               | `'no-store'`       | Fetch cache mode                   |
| `onSpan`       | `(event: SpanEvent) => void` | `undefined`        | Observability callback             |
| `onError`      | `OnErrorHandler`             | `undefined`        | Global error handler               |
| `errorSchema`  | `StandardSchema`             | `undefined`        | Backend error body schema          |
| `errorMessage` | `(data: unknown) => string`  | `undefined`        | Extract message from error data    |

## Backend error schemas

Different backends return different error shapes. Use `errorSchema` to decode them with type safety.

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

// NestJS / class-validator
const api = createComposableFetcher({
  errorSchema: z.object({
    statusCode: z.number(),
    message: z.array(z.string()),
  }),
  errorMessage: (data) => data.message.join(', '),
});

// Next.js API routes (default — works without config)
// Automatically decodes { "error": "..." }
const api = createComposableFetcher();
```

Per-request override:

```ts
await api
  .url('/api/external')
  .errorSchema(ExternalErrorSchema, (data) => data.detail)
  .body(payload)
  .run('POST');
```

### Accessing typed error data

```ts
try {
  await api.url('/api/users').body({ email, name }).run('POST');
} catch (err) {
  const fe = (err as Error & { fetchError: FetchError }).fetchError;
  if (fe.type === 'http' && fe.data) {
    const violations = fe.data as {
      violations: Array<{ propertyPath: string; message: string }>;
    };
    for (const v of violations.violations) {
      form.setError(v.propertyPath, { message: v.message });
    }
  }
}
```

## Error handling with retry

Composable at two levels: config (global) and builder (per-request). Builder overrides config.

```ts
type OnErrorHandler = (
  error: FetchError,
  retry: (options?: { headers?: Record<string, string> }) => Promise<unknown>,
) => Promise<unknown> | void;
```

- Return `retry()` result — caller gets the retried response transparently
- Return `void` — error throws as normal
- `retry()` only works once per request — prevents infinite loops

### JWT refresh

```ts
const api = createComposableFetcher({
  headers: { Authorization: `Bearer ${getAccessToken()}` },
  onError: async (error, retry) => {
    if (error.type !== 'http' || error.status !== 401) return;
    const { accessToken } = await refreshAccessToken();
    setAccessToken(accessToken);
    return retry({ headers: { Authorization: `Bearer ${accessToken}` } });
  },
});
```

### Multi-status handling

```ts
const api = createComposableFetcher({
  onError: async (error, retry) => {
    if (error.type !== 'http') return;
    switch (error.status) {
      case 401:
        return retry({
          headers: { Authorization: `Bearer ${await refresh()}` },
        });
      case 403:
        redirectToLogin();
        return;
      case 429:
        await delay(1000);
        return retry();
    }
  },
});
```

## Error types

A discriminated union `FetchError = NetworkError | HttpError | ParseError`:

```ts
type NetworkError = { type: 'network'; message: string };
type HttpError    = { type: 'http'; status: number; statusText: string; message: string; data?: unknown };
type ParseError   = { type: 'parse'; message: string; issues: string[] };
```

## Headers

Merged in order (later wins):

1. Built-in (`Accept: application/json`, `Content-Type` for mutations)
2. Instance `headers` from `createComposableFetcher()`
3. Builder `.headers()`
4. Retry `headers` from `retry()`

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

### Sentry integration

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

## React Query integration

```ts
function useGetUsers() {
  return useQuery(['users'], () =>
    composableFetcher
      .url('/api/admin/users')
      .schema(UsersResponseSchema)
      .run('GET'),
  );
}

function useAddUser() {
  const qc = useQueryClient();
  return useMutation(
    (email: string) =>
      composableFetcher.url('/api/admin/users').body({ email }).run('POST'),
    { onSuccess: () => qc.invalidateQueries(['users']) },
  );
}
```

## Testing

Test utilities are available from a separate entry point:

```ts
import {
  createComposableFetcherDependenciesMock,
  mockFetchResponse,
  mockFetchNetworkError,
  createMockSchema,
  createFailingMockSchema,
} from '@darna-digital/composable-fetcher/testing';
import { createComposableFetcherFunctions } from '@darna-digital/composable-fetcher';

// Setup
const fetchMock = vi.fn();
const deps = createComposableFetcherDependenciesMock({ fetch: fetchMock });
const fns = createComposableFetcherFunctions(deps);

// Queue a response
mockFetchResponse(fetchMock, { status: 200, body: { users: [] } });

// Execute
const result = await fns.execute({
  url: '/api/users',
  method: 'GET',
  op: 'query',
  name: 'getUsers',
  fallback: 'failed',
  headers: {},
  schema: createMockSchema({ users: [] }),
});

// Assert
expect(result).toEqual({ users: [] });
```

### Test helpers

| Helper                                     | Description                                   |
| ------------------------------------------ | --------------------------------------------- |
| `createComposableFetcherDependenciesMock()` | Full dependencies mock with optional overrides |
| `mockFetchResponse(fetchMock, config)`      | Queue a successful/error response             |
| `mockFetchNetworkError(fetchMock)`          | Queue a network failure                       |
| `createMockSchema<T>(output)`              | Standard Schema that always succeeds          |
| `createFailingMockSchema(message)`         | Standard Schema that always fails             |

## Exports

### `@darna-digital/composable-fetcher`

| Export                            | Kind     | Description                            |
| --------------------------------- | -------- | -------------------------------------- |
| `composableFetcher`               | const    | Default instance                       |
| `createComposableFetcher`         | function | Creates a configured instance          |
| `createComposableFetcherFunctions`| function | Low-level DI functions layer           |
| `resolveHeaders`                  | function | Header merge utility                   |
| `toError`                         | function | Converts FetchError to throwable Error |
| `isQueryMethod`                   | function | Checks if method is GET/HEAD/OPTIONS   |

### `@darna-digital/composable-fetcher/testing`

| Export                                     | Kind     | Description                      |
| ------------------------------------------ | -------- | -------------------------------- |
| `createComposableFetcherDependenciesMock()` | function | Creates mock dependencies        |
| `mockFetchResponse()`                      | function | Queues a mock response           |
| `mockFetchNetworkError()`                  | function | Queues a network error           |
| `createMockSchema()`                       | function | Always-succeeding schema         |
| `createFailingMockSchema()`                | function | Always-failing schema            |

## License

MIT

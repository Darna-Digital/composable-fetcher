/**
 * Standard Schema v1 interface.
 * Compatible with Zod, Valibot, ArkType, and any library
 * implementing the Standard Schema specification.
 *
 * @see https://github.com/standard-schema/standard-schema
 */
export type StandardSchema<T = unknown> = {
  readonly '~standard': {
    readonly version: 1;
    readonly validate: (
      value: unknown,
    ) => StandardResult<T> | Promise<StandardResult<T>>;
  };
};

export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

/** Extracts the output type from a Standard Schema. */
export type InferOutput<S extends StandardSchema> =
  S extends StandardSchema<infer T> ? T : never;

/** A network-level error (DNS failure, timeout, no internet, etc.). */
export type NetworkError = { type: 'network'; message: string };

/** An HTTP error response (status >= 400). */
export type HttpError = {
  type: 'http';
  status: number;
  statusText: string;
  message: string;
  /** Validated error body when an `errorSchema` matches. */
  data?: unknown;
};

/** A response parsing/validation error. */
export type ParseError = {
  type: 'parse';
  message: string;
  issues: string[];
};

/** Discriminated union of all fetch error types. */
export type FetchError = NetworkError | HttpError | ParseError;

/** Observability event emitted for every request. */
export type SpanEvent = {
  name: string;
  op: 'query' | 'mutate';
  url: string;
  method: string;
  status?: number;
  durationMs: number;
  ok: boolean;
  error?: FetchError;
};

/** Options that can be passed when retrying a request. */
export type RequestOptions = {
  headers?: Record<string, string>;
};

/**
 * Error handler signature.
 *
 * - Return `retry()` result to transparently retry the request.
 * - Return `void` to let the error throw as normal.
 * - `retry()` only works once per request to prevent infinite loops.
 */
export type OnErrorHandler = (
  error: FetchError,
  retry: (options?: RequestOptions) => Promise<unknown>,
) => Promise<unknown> | void;

/** Dependencies injected into the composable functions layer. */
export type ComposableFetcherDependencies = {
  sideEffects: {
    fetch: typeof fetch;
    onSpan?: (event: SpanEvent) => void;
    onError?: OnErrorHandler;
    errorMessage?: (data: unknown) => string;
  };
  data: {
    errorSchema?: StandardSchema;
  };
};

/** Parameters for the core `execute` function. */
export type ExecuteParams = {
  url: string;
  method: string;
  op: 'query' | 'mutate';
  name: string;
  fallback: string;
  headers: Record<string, string>;
  body?: unknown;
  schema?: StandardSchema;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  errorSchema?: StandardSchema;
  errorMessage?: (data: unknown) => string;
  onSpan?: (event: SpanEvent) => void;
  onError?: OnErrorHandler;
  isRetry?: boolean;
};

/** Return type of `createComposableFetcherFunctions`. */
export type ComposableFetcherFunctions = {
  execute: (params: ExecuteParams) => Promise<unknown>;
};

export type QueryMethod = 'GET' | 'HEAD' | 'OPTIONS';
export type MutateMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** All supported HTTP methods. */
export type HttpMethod = QueryMethod | MutateMethod;

/** Fluent builder for composing fetch requests. */
export type Builder<T = void> = {
  /** Validate the response body against a Standard Schema. */
  schema<S extends StandardSchema>(s: S): Builder<InferOutput<S>>;
  /** Validate error response bodies with an optional message extractor. */
  errorSchema<S extends StandardSchema>(
    s: S,
    messageExtractor?: (data: InferOutput<S>) => string,
  ): Builder<T>;
  /** Set the span name for observability. Defaults to "METHOD /url". */
  name(name: string): Builder<T>;
  /** Set a fallback error message when no error body is available. */
  fallback(message: string): Builder<T>;
  /** Set per-request headers (merged with instance and built-in headers). */
  headers(headers: Record<string, string>): Builder<T>;
  /** Set the request body (automatically JSON-stringified for mutations). */
  body(body: unknown): Builder<T>;
  /** Set a per-request error handler (overrides instance-level handler). */
  onError(handler: OnErrorHandler): Builder<T>;
  /** Execute the request. Returns `Promise<T>` where T is inferred from the schema. */
  run(method: HttpMethod): Promise<T>;
};

/** Configuration for creating a composable fetcher instance. */
export type FetcherConfig = {
  /** Custom fetch implementation (useful for testing or SSR). */
  fetchFn?: typeof fetch;
  /** Observability callback invoked for every request. */
  onSpan?: (event: SpanEvent) => void;
  /** Global error handler with retry support. */
  onError?: OnErrorHandler;
  /** Global error body schema for decoding backend errors. */
  errorSchema?: StandardSchema;
  /** Extract a human-readable message from validated error data. */
  errorMessage?: (data: unknown) => string;
  /** Default headers applied to all requests. */
  headers?: Record<string, string>;
  /** Fetch credentials mode. Defaults to `'include'`. */
  credentials?: RequestCredentials;
  /** Fetch cache mode. Defaults to `'no-store'`. */
  cache?: RequestCache;
};

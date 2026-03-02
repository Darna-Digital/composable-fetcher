import type {
  ComposableFetcherDependencies,
  ComposableFetcherFunctions,
  ExecuteParams,
  FetchError,
  FetcherThrownError,
  HttpError,
  InputError,
  RequestOptions,
  SpanEvent,
  StandardSchema,
} from '../entity/composable-fetcher.interfaces.js';

/**
 * Merges header layers in order. Later layers override earlier ones.
 * Always includes `Accept: application/json` as the base.
 */
export function resolveHeaders(
  ...layers: Array<Record<string, string> | undefined>
): Record<string, string> {
  return Object.assign({ Accept: 'application/json' }, ...layers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFetchError(value: unknown): value is FetchError {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'network':
      return typeof value.message === 'string';
    case 'http':
      return (
        typeof value.status === 'number' &&
        typeof value.statusText === 'string' &&
        typeof value.message === 'string'
      );
    case 'parse':
    case 'input':
      return (
        typeof value.message === 'string' && isStringArray(value.issues)
      );
    default:
      return false;
  }
}

/** Type guard for errors thrown by composable-fetcher. */
export function isComposableFetcherError(
  error: unknown,
): error is FetcherThrownError<unknown> {
  if (!(error instanceof Error)) return false;
  if (!('fetchError' in error)) return false;

  const candidate = (error as { fetchError?: unknown }).fetchError;
  return isFetchError(candidate);
}

/** Safely extracts `FetchError` from unknown thrown values. */
export function getFetchError<D = unknown>(
  error: unknown,
): FetchError<D> | undefined {
  if (!isComposableFetcherError(error)) return undefined;
  return error.fetchError as FetchError<D>;
}

/** Produces a UI-ready message from unknown thrown values. */
export function toErrorMessage(
  error: unknown,
  fallback = 'Unexpected error',
): string {
  const fetchError = getFetchError(error);
  if (!fetchError) return fallback;

  if (fetchError.type !== 'input' && fetchError.type !== 'parse') {
    return fetchError.message;
  }

  if (fetchError.issues.length === 0) {
    return fetchError.message;
  }

  return `${fetchError.message}: ${fetchError.issues.join(', ')}`;
}

/**
 * Converts a `FetchError` into a throwable `Error` with
 * the original `FetchError` attached as `.fetchError`.
 */
export function toError<D = unknown>(fe: FetchError<D>): FetcherThrownError<D> {
  const err = new Error(fe.message) as FetcherThrownError<D>;
  err.name = `FetchError.${fe.type}`;
  err.fetchError = fe;
  return err;
}

/** Returns `true` for HTTP methods that are considered queries (GET, HEAD, OPTIONS). */
export function isQueryMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function hasErrorString(data: unknown): data is { error: string } {
  if (typeof data !== 'object' || data === null) return false;
  if (!('error' in data)) return false;
  return typeof data.error === 'string';
}

async function decodeErrorBody(params: {
  data: unknown;
  fallback: string;
  errorSchema?: StandardSchema;
  errorMessage?: (data: unknown) => string;
}): Promise<{ message: string; data?: unknown }> {
  const { data, fallback, errorSchema, errorMessage } = params;

  if (!errorSchema) {
    if (hasErrorString(data)) {
      return { message: data.error };
    }
    return { message: fallback };
  }

  const result = await errorSchema['~standard'].validate(data);

  if (result.issues) return { message: fallback };

  const message = errorMessage ? errorMessage(result.value) : fallback;
  return { message, data: result.value };
}

/**
 * Creates the composable functions layer with injected dependencies.
 * All side effects (fetch, observability, error handling) are injected,
 * making the core `execute` function fully testable.
 */
export function createComposableFetcherFunctions(
  d: ComposableFetcherDependencies,
): ComposableFetcherFunctions {
  async function execute(params: ExecuteParams): Promise<unknown> {
    const {
      url,
      method,
      op,
      name,
      fallback,
      headers,
      schema,
      inputSchema,
      credentials,
      cache,
      isRetry = false,
    } = params;

    let body = params.body;

    const onSpan = params.onSpan ?? d.sideEffects.onSpan;
    const catchHandler = params.catch ?? d.sideEffects.catch;
    const errorSchema = params.errorSchema ?? d.data.errorSchema;
    const errorMessage = params.errorMessage ?? d.sideEffects.errorMessage;
    const errorFormatter =
      params.errorFormatter ?? d.sideEffects.errorFormatter;

    const start = performance.now();

    function span(p: { status?: number; ok: boolean; error?: FetchError }) {
      onSpan?.({
        name,
        op,
        url,
        method,
        durationMs: Math.round(performance.now() - start),
        ...p,
      });
    }

    function handleError(error: FetchError): Promise<unknown> {
      if (isRetry || !catchHandler) throw toError(error);

      const retryFn = (retryOptions?: RequestOptions) =>
        execute({
          ...params,
          headers: resolveHeaders(headers, retryOptions?.headers),
          isRetry: true,
        });

      const result = catchHandler({ error, retry: retryFn });
      if (result === undefined) return Promise.resolve(undefined);
      return result;
    }

    function format(error: FetchError): FetchError {
      if (!errorFormatter) return error;

      const message = errorFormatter(error);
      if (!message || message === error.message) return error;

      return { ...error, message };
    }

    if (inputSchema && body !== undefined) {
      const inputResult = await inputSchema['~standard'].validate(body);

      if (inputResult.issues) {
        const error: InputError = {
          type: 'input',
          message: 'Invalid input',
          issues: inputResult.issues.map((i) => i.message),
        };
        const formatted = format(error);
        span({ ok: false, error: formatted });
        return handleError(formatted);
      }

      body = inputResult.value;
    }

    let response: Response;

    try {
      response = await d.sideEffects.fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials,
        cache,
      });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      const error: FetchError = {
        type: 'network',
        message: `Network error: ${detail}`,
      };
      const formatted = format(error);
      span({ ok: false, error: formatted });
      return handleError(formatted);
    }

    if (!response.ok) {
      const rawData: unknown = await response.json().catch(() => undefined);
      const decoded = await decodeErrorBody({
        data: rawData,
        fallback,
        errorSchema,
        errorMessage,
      });

      const error: HttpError = {
        type: 'http',
        status: response.status,
        statusText: response.statusText,
        message: decoded.message,
        data: decoded.data,
      };
      const formatted = format(error);
      span({ status: response.status, ok: false, error: formatted });
      return handleError(formatted);
    }

    if (!schema) {
      span({ status: response.status, ok: true });
      return undefined;
    }

    const data: unknown = await response.json().catch(() => undefined);
    const result = await schema['~standard'].validate(data);

    if (result.issues) {
      const error: FetchError = {
        type: 'parse',
        message: 'Unexpected response format',
        issues: result.issues.map((i) => i.message),
      };
      const formatted = format(error);
      span({ status: response.status, ok: false, error: formatted });
      return handleError(formatted);
    }

    span({ status: response.status, ok: true });
    return result.value;
  }

  return { execute };
}

import type {
  ComposableFetcherDependencies,
  ComposableFetcherFunctions,
  ExecuteParams,
  FetchError,
  HttpError,
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

/**
 * Converts a `FetchError` into a throwable `Error` with
 * the original `FetchError` attached as `.fetchError`.
 */
export function toError(fe: FetchError): Error & { fetchError: FetchError } {
  const err = new Error(fe.message) as Error & { fetchError: FetchError };
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
      body,
      schema,
      credentials,
      cache,
      isRetry = false,
    } = params;

    const onSpan = params.onSpan ?? d.sideEffects.onSpan;
    const catchHandler = params.catch ?? d.sideEffects.catch;
    const errorSchema = params.errorSchema ?? d.data.errorSchema;
    const errorMessage = params.errorMessage ?? d.sideEffects.errorMessage;

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

      const result = catchHandler(error, retryFn);
      if (result === undefined) return Promise.resolve(undefined);
      return result;
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
      span({ ok: false, error });
      return handleError(error);
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
      span({ status: response.status, ok: false, error });
      return handleError(error);
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
      span({ status: response.status, ok: false, error });
      return handleError(error);
    }

    span({ status: response.status, ok: true });
    return result.value;
  }

  return { execute };
}

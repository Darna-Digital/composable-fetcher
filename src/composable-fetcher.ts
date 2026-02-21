import type {
  Builder,
  FetcherConfig,
  OnErrorHandler,
  StandardSchema,
} from './types.js';
import {
  createComposableFetcherFunctions,
  isQueryMethod,
  resolveHeaders,
} from './functions.js';

/**
 * Creates a composable fetcher instance with the given configuration.
 *
 * @example
 * ```ts
 * const api = createComposableFetcher({
 *   headers: { Authorization: `Bearer ${token}` },
 *   onError: async (error, retry) => {
 *     if (error.type === 'http' && error.status === 401) {
 *       const { accessToken } = await refreshToken();
 *       return retry({ headers: { Authorization: `Bearer ${accessToken}` } });
 *     }
 *   },
 * });
 *
 * const users = await api
 *   .url('/api/users')
 *   .schema(UsersSchema)
 *   .run('GET');
 * ```
 */
export function createComposableFetcher(config: FetcherConfig = {}) {
  function getFetchFn(): typeof fetch {
    if (config.fetchFn) return config.fetchFn;
    if (typeof globalThis.fetch === 'function')
      return globalThis.fetch.bind(globalThis);
    throw new Error('No fetch function available. Pass fetchFn in config.');
  }

  function url(targetUrl: string): Builder {
    let _schema: StandardSchema | undefined;
    let _errorSchema: StandardSchema | undefined;
    let _errorMessage: ((data: any) => string) | undefined;
    let _name = '';
    let _fallback = '';
    let _headers: Record<string, string> | undefined;
    let _body: unknown;
    let _onError: OnErrorHandler | undefined;

    const self: Builder = {
      schema(s) {
        _schema = s;
        return self as Builder<never>;
      },

      errorSchema(s, messageExtractor?) {
        _errorSchema = s;
        _errorMessage = messageExtractor;
        return self;
      },

      name(n) {
        _name = n;
        return self;
      },

      fallback(message) {
        _fallback = message;
        return self;
      },

      headers(h) {
        _headers = h;
        return self;
      },

      body(b) {
        _body = b;
        return self;
      },

      onError(handler) {
        _onError = handler;
        return self;
      },

      run(method) {
        const isMutation = !isQueryMethod(method);

        const fns = createComposableFetcherFunctions({
          sideEffects: {
            fetch: getFetchFn(),
            onSpan: config.onSpan,
            onError: _onError ?? config.onError,
            errorMessage: _errorMessage ?? config.errorMessage,
          },
          data: {
            errorSchema: _errorSchema ?? config.errorSchema,
          },
        });

        return fns.execute({
          url: targetUrl,
          method,
          op: isMutation ? 'mutate' : 'query',
          name: _name || `${method} ${targetUrl}`,
          fallback: _fallback || `Request failed: ${targetUrl}`,
          headers: resolveHeaders(
            config.headers,
            _headers,
            isMutation ? { 'Content-Type': 'application/json' } : undefined,
          ),
          body: isMutation ? _body : undefined,
          schema: _schema,
          credentials: config.credentials ?? 'include',
          cache: config.cache ?? 'no-store',
        }) as Promise<never>;
      },
    };

    return self;
  }

  return {
    /** Start building a request to the given URL. */
    url,
    /** Create a new instance with merged configuration. */
    configure(next: FetcherConfig) {
      return createComposableFetcher({ ...config, ...next });
    },
  };
}

/** Default composable fetcher instance. */
export const composableFetcher = createComposableFetcher();

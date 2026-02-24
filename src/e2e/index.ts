/**
 * Fake API server simulator for e2e tests.
 *
 * Simulates a REST API by routing `fetch` calls through an in-memory
 * handler registry. Each handler receives the request info and returns
 * a `Response`-like object — just like a real server would.
 */

type RouteHandler = (request: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}) => {
  status: number;
  statusText: string;
  body: unknown;
  delay?: number;
};

type Route = {
  method: string;
  path: string;
  handler: RouteHandler;
};

/**
 * Creates a fake API server that intercepts fetch calls.
 *
 * @example
 * ```ts
 * const server = createFakeApi();
 * server.get('/api/users', () => ({
 *   status: 200, statusText: 'OK',
 *   body: [{ id: '1', name: 'Alice' }],
 * }));
 *
 * const api = createComposableFetcher({ fetchFn: server.fetch });
 * const users = await api.url('/api/users').schema(schema).run('GET');
 * ```
 */
export function createFakeApi() {
  const routes: Route[] = [];

  function addRoute(method: string, path: string, handler: RouteHandler) {
    routes.push({ method: method.toUpperCase(), path, handler });
  }

  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const rawBody = init?.body;
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined;

    const route = routes.find(
      (r) => r.method === method && r.path === url,
    );

    if (!route) {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = route.handler({ url, method, headers, body });

    if (result.delay) {
      await new Promise((r) => setTimeout(r, result.delay));
    }

    // Null-body statuses (204, 304) must not have a body
    const isNullBody = result.status === 204 || result.status === 304;

    return new Response(isNullBody ? null : JSON.stringify(result.body), {
      status: result.status,
      statusText: result.statusText,
      headers: isNullBody ? {} : { 'Content-Type': 'application/json' },
    });
  };

  return {
    fetch: fetchFn,
    get: (path: string, handler: RouteHandler) => addRoute('GET', path, handler),
    post: (path: string, handler: RouteHandler) => addRoute('POST', path, handler),
    put: (path: string, handler: RouteHandler) => addRoute('PUT', path, handler),
    patch: (path: string, handler: RouteHandler) => addRoute('PATCH', path, handler),
    delete: (path: string, handler: RouteHandler) => addRoute('DELETE', path, handler),
  };
}

/**
 * Creates a fetch function that simulates a network failure.
 */
export function createFailingFetch(): typeof fetch {
  return async () => {
    throw new TypeError('Failed to fetch');
  };
}

/**
 * Creates a fetch function that fails N times then delegates to the real fetch.
 */
export function createIntermittentFetch(
  realFetch: typeof fetch,
  failCount: number,
): typeof fetch {
  let failures = 0;
  return async (...args: Parameters<typeof fetch>) => {
    if (failures < failCount) {
      failures++;
      throw new TypeError('Failed to fetch');
    }
    return realFetch(...args);
  };
}

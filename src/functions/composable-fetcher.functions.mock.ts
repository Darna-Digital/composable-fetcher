/**
 * Test utilities for composable-fetcher.
 *
 * Import from `@darna-digital/composable-fetcher/testing`:
 *
 * ```ts
 * import {
 *   createComposableFetcherDependenciesMock,
 *   mockFetchResponse,
 *   mockFetchNetworkError,
 *   createMockSchema,
 *   createFailingMockSchema,
 * } from '@darna-digital/composable-fetcher/testing';
 * ```
 */

import type {
  ComposableFetcherDependencies,
  StandardSchema,
} from '../entity/composable-fetcher.interfaces.js';

type MockFn = (...args: any[]) => any;

/**
 * Creates a full `ComposableFetcherDependencies` mock with optional overrides.
 *
 * Works with any test framework's mock functions (Vitest `vi.fn()`, Jest `jest.fn()`, etc.).
 * Pass your mock `fetch` function as an override.
 */
export function createComposableFetcherDependenciesMock(
  overrides?: Partial<{
    fetch: MockFn;
    onSpan: MockFn;
    catch: MockFn;
    errorSchema: StandardSchema;
    errorMessage: MockFn;
  }>,
): ComposableFetcherDependencies {
  const noopFn = () => {};
  return {
    sideEffects: {
      fetch: (overrides?.fetch ?? noopFn) as typeof fetch,
      onSpan: overrides?.onSpan,
      catch: overrides?.catch,
      errorMessage: overrides?.errorMessage,
    },
    data: {
      errorSchema: overrides?.errorSchema,
    },
  };
}

type MockResponseConfig = {
  status?: number;
  statusText?: string;
  body?: unknown;
  ok?: boolean;
};

/**
 * Queues a mock fetch response.
 *
 * @example
 * ```ts
 * const fetchMock = vi.fn();
 * mockFetchResponse(fetchMock, { status: 200, body: { users: [] } });
 * ```
 */
export function mockFetchResponse(
  fetchMock: MockFn,
  config: MockResponseConfig = {},
) {
  const { status = 200, statusText = 'OK', body = {}, ok } = config;
  const response = {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as Response;

  // Support both Vitest (mockResolvedValueOnce) and plain functions
  if ('mockResolvedValueOnce' in fetchMock) {
    (fetchMock as any).mockResolvedValueOnce(response);
  } else {
    throw new Error(
      'fetchMock must have a mockResolvedValueOnce method. Use vi.fn() or jest.fn().',
    );
  }
}

/**
 * Queues a network error on the mock fetch function.
 *
 * @example
 * ```ts
 * const fetchMock = vi.fn();
 * mockFetchNetworkError(fetchMock);
 * ```
 */
export function mockFetchNetworkError(fetchMock: MockFn) {
  if ('mockRejectedValueOnce' in fetchMock) {
    (fetchMock as any).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  } else {
    throw new Error(
      'fetchMock must have a mockRejectedValueOnce method. Use vi.fn() or jest.fn().',
    );
  }
}

/**
 * Creates a Standard Schema that always succeeds with the given output.
 *
 * @example
 * ```ts
 * const schema = createMockSchema({ users: [] });
 * ```
 */
export function createMockSchema<T>(output: T): StandardSchema<T> {
  return {
    '~standard': {
      version: 1,
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

/**
 * Creates a Standard Schema that always fails with the given message.
 *
 * @example
 * ```ts
 * const schema = createFailingMockSchema('expected string');
 * ```
 */
export function createFailingMockSchema(message: string): StandardSchema {
  return {
    '~standard': {
      version: 1,
      validate: () => ({ issues: [{ message }] }),
    },
  };
}

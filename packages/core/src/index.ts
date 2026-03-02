// Main entry point — re-exports everything consumers need.

export {
  createComposableFetcher,
  composableFetcher,
} from './composable-fetcher.js';

export {
  resolveHeaders,
  toError,
  getFetchError,
  isComposableFetcherError,
  toErrorMessage,
  isQueryMethod,
  createComposableFetcherFunctions,
} from './functions/composable-fetcher.functions.js';

export type {
  Builder,
  CatchHandler,
  FetcherConfig,
  FetchError,
  FetcherThrownError,
  HttpError,
  NetworkError,
  ParseError,
  InputError,
  HttpMethod,
  QueryMethod,
  MutateMethod,
  RequestOptions,
  SpanEvent,
  StandardSchema,
  InferOutput,
  InferInput,
  ComposableFetcherDependencies,
  ComposableFetcherFunctions,
  ExecuteParams,
} from './entity/composable-fetcher.interfaces.js';

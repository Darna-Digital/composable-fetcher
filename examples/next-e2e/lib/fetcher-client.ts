import {
  createComposableFetcher,
  type FetchError,
} from '@darna-digital/composable-fetcher';

export const api = createComposableFetcher();

export type ApiError = {
  error: string;
  issues?: string[];
};

export function toUiMessage(error: unknown): string {
  const fetchError = (error as Error & { fetchError?: FetchError<ApiError> })
    .fetchError;

  if (!fetchError) return 'Unexpected error';
  if (fetchError.type === 'input') return fetchError.issues.join(', ');
  if (fetchError.type === 'parse') return `parse: ${fetchError.issues.join(', ')}`;
  if (fetchError.type === 'http' && fetchError.data?.issues?.length) {
    return `http: ${fetchError.data.issues.join(', ')}`;
  }

  return fetchError.message;
}

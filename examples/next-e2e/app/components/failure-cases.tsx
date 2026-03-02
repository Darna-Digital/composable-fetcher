'use client';

import { useState } from 'react';
import {
  createComposableFetcher,
  type FetchError,
} from '@darna-digital/composable-fetcher';
import {
  CreateItemInputSchema,
  CreateItemResponseSchema,
  ErrorResponseSchema,
} from '@/lib/item-schemas';
import styles from '../page.module.css';

const api = createComposableFetcher();

type ApiError = {
  error: string;
  issues?: string[];
};

function getMessage(error: unknown): string {
  const fetchError = (error as Error & { fetchError?: FetchError<ApiError> })
    .fetchError;

  if (!fetchError) return 'Unexpected error';
  if (fetchError.type === 'input') return `input: ${fetchError.issues.join(', ')}`;
  if (fetchError.type === 'parse') return `parse: ${fetchError.issues.join(', ')}`;
  if (fetchError.type === 'http' && fetchError.data?.issues?.length) {
    return `http: ${fetchError.data.issues.join(', ')}`;
  }

  return `${fetchError.type}: ${fetchError.message}`;
}

export function FailureCases() {
  const [result, setResult] = useState('No checks run yet');
  const [pending, setPending] = useState(false);

  async function runInputFailure() {
    setPending(true);
    setResult('');

    try {
      await api
        .url('/api/items')
        .input(CreateItemInputSchema)
        .body({ title: '', count: 0 })
        .schema(CreateItemResponseSchema)
        .run('POST');

      setResult('Expected input validation to fail, but request succeeded.');
      return;
    } catch (error) {
      setResult(getMessage(error));
      return;
    } finally {
      setPending(false);
    }
  }

  async function runHttpFailure() {
    setPending(true);
    setResult('');

    try {
      await api
        .url('/api/items/http-error')
        .input(CreateItemInputSchema)
        .body({ title: 'Notebook', count: 2 })
        .errorSchema(ErrorResponseSchema, (data) => data.error)
        .schema(CreateItemResponseSchema)
        .run('POST');

      setResult('Expected HTTP error, but request succeeded.');
      return;
    } catch (error) {
      setResult(getMessage(error));
      return;
    } finally {
      setPending(false);
    }
  }

  async function runParseFailure() {
    setPending(true);
    setResult('');

    try {
      await api
        .url('/api/items/parse-error')
        .input(CreateItemInputSchema)
        .body({ title: 'Notebook', count: 2 })
        .schema(CreateItemResponseSchema)
        .run('POST');

      setResult('Expected parse validation error, but request succeeded.');
      return;
    } catch (error) {
      setResult(getMessage(error));
      return;
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card}>
      <h2>Failure Cases</h2>
      <p>Run explicit checks for input, HTTP, and parse errors.</p>

      <div className={styles.actions}>
        <button
          data-testid="run-input-failure"
          className={styles.button}
          type="button"
          disabled={pending}
          onClick={runInputFailure}
        >
          Input validation fails
        </button>

        <button
          data-testid="run-http-failure"
          className={styles.button}
          type="button"
          disabled={pending}
          onClick={runHttpFailure}
        >
          HTTP error schema fails
        </button>

        <button
          data-testid="run-parse-failure"
          className={styles.button}
          type="button"
          disabled={pending}
          onClick={runParseFailure}
        >
          Parse schema fails
        </button>
      </div>

      <p data-testid="failure-result" className={styles.message}>
        {result}
      </p>
    </section>
  );
}

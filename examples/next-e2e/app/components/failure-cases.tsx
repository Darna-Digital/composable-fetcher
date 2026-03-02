'use client';

import { useState, useTransition } from 'react';
import {
  CreateItemInputSchema,
  CreateItemResponseSchema,
  ErrorResponseSchema,
} from '@/lib/item-schemas';
import { api, toUiMessage } from '@/lib/fetcher-client';
import styles from '../page.module.css';

export function FailureCases() {
  const [result, setResult] = useState('No checks run yet');
  const [isPending, startTransition] = useTransition();

  function runCase(run: () => Promise<unknown>, expectedFailureMessage: string) {
    startTransition(async () => {
      setResult('');

      try {
        await run();
        setResult(expectedFailureMessage);
      } catch (error) {
        setResult(toUiMessage(error));
      }
    });
  }

  function runInputFailure() {
    return runCase(
      () =>
        api
          .url('/api/items')
          .input(CreateItemInputSchema)
          .body({ title: '', count: 0 })
          .schema(CreateItemResponseSchema)
          .run('POST'),
      'Expected input validation to fail, but request succeeded.',
    );
  }

  function runHttpFailure() {
    return runCase(
      () =>
        api
          .url('/api/items/http-error')
          .input(CreateItemInputSchema)
          .body({ title: 'Notebook', count: 2 })
          .errorSchema(ErrorResponseSchema, (data) => data.error)
          .schema(CreateItemResponseSchema)
          .run('POST'),
      'Expected HTTP error, but request succeeded.',
    );
  }

  function runParseFailure() {
    return runCase(
      () =>
        api
          .url('/api/items/parse-error')
          .input(CreateItemInputSchema)
          .body({ title: 'Notebook', count: 2 })
          .schema(CreateItemResponseSchema)
          .run('POST'),
      'Expected parse validation error, but request succeeded.',
    );
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
          disabled={isPending}
          onClick={runInputFailure}
        >
          Input validation fails
        </button>

        <button
          data-testid="run-http-failure"
          className={styles.button}
          type="button"
          disabled={isPending}
          onClick={runHttpFailure}
        >
          HTTP error schema fails
        </button>

        <button
          data-testid="run-parse-failure"
          className={styles.button}
          type="button"
          disabled={isPending}
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

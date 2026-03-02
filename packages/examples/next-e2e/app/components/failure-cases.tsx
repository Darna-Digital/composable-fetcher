'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreateItemInputSchema,
  CreateItemResponseSchema,
  ErrorResponseSchema,
} from '@/lib/item-schemas';
import { api, toUiMessage } from '@/lib/fetcher-client';
import styles from '../page.module.css';

export function FailureCases() {
  const [result, setResult] = useState('No checks run yet');

  const inputFailure = useMutation({
    mutationFn: () =>
      api
        .url('/api/items')
        .input(CreateItemInputSchema)
        .body({ title: '', count: 0 })
        .schema(CreateItemResponseSchema)
        .run('POST'),
    onMutate: () => setResult(''),
    onSuccess: () => setResult('Expected input validation to fail, but request succeeded.'),
    onError: (error) => setResult(toUiMessage(error)),
  });

  const httpFailure = useMutation({
    mutationFn: () =>
      api
        .url('/api/items/http-error')
        .input(CreateItemInputSchema)
        .body({ title: 'Notebook', count: 2 })
        .errorSchema(ErrorResponseSchema, (data) => data.error)
        .schema(CreateItemResponseSchema)
        .run('POST'),
    onMutate: () => setResult(''),
    onSuccess: () => setResult('Expected HTTP error, but request succeeded.'),
    onError: (error) => setResult(toUiMessage(error)),
  });

  const parseFailure = useMutation({
    mutationFn: () =>
      api
        .url('/api/items/parse-error')
        .input(CreateItemInputSchema)
        .body({ title: 'Notebook', count: 2 })
        .schema(CreateItemResponseSchema)
        .run('POST'),
    onMutate: () => setResult(''),
    onSuccess: () => setResult('Expected parse validation error, but request succeeded.'),
    onError: (error) => setResult(toUiMessage(error)),
  });

  const isPending =
    inputFailure.isPending || httpFailure.isPending || parseFailure.isPending;

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
          onClick={() => inputFailure.mutate()}
        >
          Input validation fails
        </button>

        <button
          data-testid="run-http-failure"
          className={styles.button}
          type="button"
          disabled={isPending}
          onClick={() => httpFailure.mutate()}
        >
          HTTP error schema fails
        </button>

        <button
          data-testid="run-parse-failure"
          className={styles.button}
          type="button"
          disabled={isPending}
          onClick={() => parseFailure.mutate()}
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

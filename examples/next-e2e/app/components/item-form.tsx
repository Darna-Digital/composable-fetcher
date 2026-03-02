'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreateItemInputSchema,
  CreateItemResponseSchema,
  ErrorResponseSchema,
  type Item,
} from '@/lib/item-schemas';
import { api, toUiMessage } from '@/lib/fetcher-client';
import styles from '../page.module.css';

export function ItemForm() {
  const [title, setTitle] = useState('');
  const [count, setCount] = useState('1');
  const [message, setMessage] = useState('');
  const [createdItem, setCreatedItem] = useState<Item | null>(null);

  const createItemMutation = useMutation({
    mutationFn: async (input: { title: string; count: number }) =>
      api
        .url('/api/items')
        .input(CreateItemInputSchema)
        .body(input)
        .errorSchema(ErrorResponseSchema, (data) => data.error)
        .schema(CreateItemResponseSchema)
        .run('POST'),
    onSuccess: (result) => {
      setCreatedItem(result.item);
      setMessage('Created item successfully.');
      setTitle('');
      setCount('1');
    },
    onError: (error) => {
      setMessage(toUiMessage(error));
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    createItemMutation.mutate({ title, count: Number(count) });
  }

  return (
    <section className={styles.card}>
      <h2>Create Item</h2>
      <p>Client-side input validation runs before the request is sent.</p>

      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.label}>
          Title
          <input
            data-testid="item-title"
            className={styles.input}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Notebook"
          />
        </label>

        <label className={styles.label}>
          Count
          <input
            data-testid="item-count"
            className={styles.input}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            type="number"
            min={1}
          />
        </label>

        <button
          data-testid="submit-item"
          className={styles.button}
          type="submit"
          disabled={createItemMutation.isPending}
        >
          {createItemMutation.isPending ? 'Creating...' : 'Create'}
        </button>
      </form>

      <p data-testid="form-message" className={styles.message}>
        {message || 'No requests yet'}
      </p>

      {createdItem && (
        <pre data-testid="created-item" className={styles.preview}>
          {JSON.stringify(createdItem, null, 2)}
        </pre>
      )}
    </section>
  );
}

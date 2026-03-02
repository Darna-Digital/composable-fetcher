'use client';

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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [createdItem, setCreatedItem] = useState<Item | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage('');

    try {
      const result = await api
        .url('/api/items')
        .input(CreateItemInputSchema)
        .body({
          title,
          count: Number(count),
        })
        .errorSchema(ErrorResponseSchema, (data) => data.error)
        .schema(CreateItemResponseSchema)
        .run('POST');

      setCreatedItem(result.item);
      setMessage('Created item successfully.');
      setTitle('');
      setCount('1');
    } catch (error) {
      setMessage(toUiMessage(error));
    } finally {
      setPending(false);
    }
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
          disabled={pending}
        >
          {pending ? 'Creating...' : 'Create'}
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

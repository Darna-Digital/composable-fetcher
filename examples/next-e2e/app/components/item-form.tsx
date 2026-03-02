'use client';

import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  CreateItemInputSchema,
  CreateItemResponseSchema,
  ErrorResponseSchema,
  type Item,
} from '@/lib/item-schemas';
import { api, toUiMessage } from '@/lib/fetcher-client';
import styles from '../page.module.css';

export function ItemForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState('');
  const [createdItem, setCreatedItem] = useState<Item | null>(null);

  async function createItem(formData: FormData) {
    setMessage('');

    const title = String(formData.get('title') ?? '');
    const count = Number(formData.get('count'));

    try {
      const result = await api
        .url('/api/items')
        .input(CreateItemInputSchema)
        .body({ title, count })
        .errorSchema(ErrorResponseSchema, (data) => data.error)
        .schema(CreateItemResponseSchema)
        .run('POST');

      setCreatedItem(result.item);
      setMessage('Created item successfully.');
      formRef.current?.reset();
    } catch (error) {
      setMessage(toUiMessage(error));
    }
  }

  return (
    <section className={styles.card}>
      <h2>Create Item</h2>
      <p>Client-side input validation runs before the request is sent.</p>

      <form ref={formRef} className={styles.form} action={createItem}>
        <label className={styles.label}>
          Title
          <input
            data-testid="item-title"
            name="title"
            className={styles.input}
            defaultValue=""
            placeholder="Notebook"
          />
        </label>

        <label className={styles.label}>
          Count
          <input
            data-testid="item-count"
            name="count"
            className={styles.input}
            defaultValue="1"
            type="number"
            min={1}
          />
        </label>

        <SubmitButton />
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

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      data-testid="submit-item"
      className={styles.button}
      type="submit"
      disabled={pending}
    >
      {pending ? 'Creating...' : 'Create'}
    </button>
  );
}

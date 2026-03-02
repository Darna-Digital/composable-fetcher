import { ItemForm } from './components/item-form';
import { FailureCases } from './components/failure-cases';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Composable Fetcher E2E Example</h1>
        <p className={styles.subtitle}>
          Uses <code>.input(zodSchema)</code> and a Next.js API route.
        </p>
        <ItemForm />
        <FailureCases />
      </main>
    </div>
  );
}

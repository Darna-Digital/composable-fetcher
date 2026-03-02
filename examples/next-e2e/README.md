# Next.js E2E Example

This example app uses `@darna-digital/composable-fetcher` with Zod in a real Next.js flow:

- Server Component page shell in `app/page.tsx`
- Small client islands in `app/components/*`
- TanStack Query mutations for request state and errors
- Frontend form in `app/components/item-form.tsx`
- Failure scenarios panel in `app/components/failure-cases.tsx`
- API route in `app/api/items/route.ts`
- Error route in `app/api/items/http-error/route.ts`
- Parse mismatch route in `app/api/items/parse-error/route.ts`
- Shared schemas in `lib/item-schemas.ts`

## Run

```bash
pnpm install
pnpm dev
```

This example uses `link:../..`, so it consumes the local library directly (no publish/release required).

Open `http://localhost:3000`.

Client components use TanStack Query mutations and keep composable-fetcher calls close to UI intent.

## Run e2e

```bash
pnpm exec playwright install chromium
pnpm e2e
```

## What to test

1. Submit with empty title -> client-side `.input()` blocks the request and shows validation error.
2. Submit valid values -> request succeeds and shows created item JSON.
3. Run **Input validation fails** -> confirms `FetchError.input` behavior.
4. Run **HTTP error schema fails** -> confirms typed HTTP error decoding.
5. Run **Parse schema fails** -> confirms `FetchError.parse` behavior.

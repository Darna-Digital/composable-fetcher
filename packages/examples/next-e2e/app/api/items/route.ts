import { NextResponse } from 'next/server';
import { CreateItemInputSchema } from '@/lib/item-schemas';

type StoredItem = {
  id: string;
  title: string;
  count: number;
};

const items: StoredItem[] = [];

export async function POST(request: Request) {
  const rawBody: unknown = await request.json().catch(() => undefined);
  const parsed = CreateItemInputSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid input',
        issues: parsed.error.issues.map((issue) => {
          const path = issue.path.join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        }),
      },
      { status: 400 },
    );
  }

  const item: StoredItem = {
    id: String(items.length + 1),
    title: parsed.data.title,
    count: parsed.data.count,
  };

  items.push(item);

  return NextResponse.json(
    {
      ok: true,
      item,
    },
    { status: 201 },
  );
}

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      ok: true,
      item: {
        id: 'x',
        title: null,
        count: 'bad',
      },
    },
    { status: 200 },
  );
}

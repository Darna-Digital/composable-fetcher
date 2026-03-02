import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'Validation failed on server',
      issues: ['title: already exists', 'count: limit exceeded'],
    },
    { status: 422 },
  );
}

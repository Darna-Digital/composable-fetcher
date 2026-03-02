import { z } from 'zod';

export const CreateItemInputSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(120),
  count: z.number().int().positive('count must be greater than 0'),
});

export const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  count: z.number().int().positive(),
});

export const CreateItemResponseSchema = z.object({
  ok: z.literal(true),
  item: ItemSchema,
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.string()).optional(),
});

export type Item = z.infer<typeof ItemSchema>;

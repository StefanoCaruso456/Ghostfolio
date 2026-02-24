import { z } from 'zod';

/**
 * Reusable Zod validation helper for tool args and tool outputs.
 *
 * Schema validation prevents silent corruption and tool hallucinations.
 * Every tool must validate its inputs AND outputs with this helper.
 */
export function validateWithZod<T>(
  schema: z.ZodType<T>,
  value: unknown,
  errCode: string,
  context: string
):
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } } {
  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  return {
    ok: false,
    error: {
      code: errCode,
      message: `Schema validation failed: ${context}`,
      details: parsed.error.flatten()
    }
  };
}

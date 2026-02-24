import { z } from 'zod';

/**
 * ActivityImportDTO — Canonical schema matching the Ghostfolio UI modal.
 *
 * This is the final validated shape that must pass before canCommit=true.
 * Mirrors CreateOrderDto (libs/common/src/lib/dtos/create-order.dto.ts):
 *
 * Required fields (from UI modal):
 *   type, symbol, date, quantity, unitPrice, fee, currency
 *
 * Optional fields:
 *   accountId, dataSource, comment, tags
 *
 * Normalization rules enforced upstream by normalizeToActivityDTO():
 *   - type: uppercase, must be valid Prisma Type enum value
 *   - date: ISO 8601 YYYY-MM-DD format
 *   - fee, quantity, unitPrice: coerced to non-negative numbers
 *   - currency: uppercase 3-char ISO 4217
 */

export const VALID_IMPORT_TYPES = [
  'BUY',
  'SELL',
  'DIVIDEND',
  'FEE',
  'INTEREST',
  'LIABILITY'
] as const;

export type ValidImportType = (typeof VALID_IMPORT_TYPES)[number];

/**
 * Strict date pattern: YYYY-MM-DD (ISO 8601 date only, no time component).
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const ActivityImportDTOSchema = z.object({
  // ─── Required fields (match UI modal) ──────────────────────────────
  type: z.enum(VALID_IMPORT_TYPES),
  symbol: z.string().min(1, 'Symbol is required'),
  date: z.string().regex(ISO_DATE_REGEX, 'Date must be in YYYY-MM-DD format'),
  quantity: z.number().min(0, 'Quantity must be >= 0'),
  unitPrice: z.number().min(0, 'Unit price must be >= 0'),
  fee: z.number().min(0, 'Fee must be >= 0'),
  currency: z
    .string()
    .length(3, 'Currency must be a 3-character ISO 4217 code')
    .transform((v) => v.toUpperCase()),

  // ─── Optional fields ───────────────────────────────────────────────
  accountId: z.string().optional(),
  dataSource: z.string().optional(),
  comment: z.string().optional().nullable()
});

export type ActivityImportDTO = z.infer<typeof ActivityImportDTOSchema>;

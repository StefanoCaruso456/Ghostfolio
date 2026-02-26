import type { CreateOrderDto } from '@ghostfolio/common/dtos';

import { Type } from '@prisma/client';

import type { MappedActivity } from '../schemas/validate-transactions.schema';

const VALID_TYPES = new Set<string>(Object.values(Type));

export interface TransformResult {
  orders: CreateOrderDto[];
  errors: { row: number; message: string }[];
}

export function transformToCreateOrderDtos(
  activities: MappedActivity[]
): TransformResult {
  const orders: CreateOrderDto[] = [];
  const errors: { row: number; message: string }[] = [];

  for (const [index, activity] of activities.entries()) {
    try {
      const normalizedType = (activity.type ?? '').toUpperCase();

      if (!VALID_TYPES.has(normalizedType)) {
        errors.push({
          row: index,
          message: `Invalid activity type: "${activity.type}"`
        });
        continue;
      }

      if (!activity.symbol) {
        errors.push({ row: index, message: 'Missing required field: symbol' });
        continue;
      }

      if (!activity.currency) {
        errors.push({
          row: index,
          message: 'Missing required field: currency'
        });
        continue;
      }

      if (!activity.date) {
        errors.push({ row: index, message: 'Missing required field: date' });
        continue;
      }

      const order: CreateOrderDto = {
        currency: activity.currency,
        date: activity.date,
        fee: activity.fee ?? 0,
        quantity: activity.quantity ?? 0,
        symbol: activity.symbol,
        type: normalizedType as Type,
        unitPrice: activity.unitPrice ?? 0
      };

      if (activity.account) {
        order.accountId = activity.account;
      }

      if (activity.comment) {
        order.comment = activity.comment;
      }

      orders.push(order);
    } catch (error) {
      errors.push({
        row: index,
        message:
          error instanceof Error
            ? error.message
            : `Unexpected error transforming row ${index}`
      });
    }
  }

  return { orders, errors };
}

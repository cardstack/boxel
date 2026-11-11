import { parseISO } from 'date-fns';
import type {
  BaseDefConstructor,
  BaseInstanceType,
} from '@cardstack/base/card-api';

export const datetimeFormat = `yyyy-MM-dd'T'HH:mm`;

// The search doc's `yyyy-MM-ddTHH:mm` (datetimeFormat), in UTC: a query
// reads a zoneless date-time as UTC, and the host matcher runs in the
// browser's zone, so the wall time must not depend on the process's.
export function queryableValue(date: Date | undefined) {
  if (date) {
    return date.toISOString().slice(0, 16);
  }
  return undefined;
}

export function serialize(date: Date | null): string | undefined {
  if (date == null) {
    return undefined;
  }
  return date.toISOString();
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  date: any,
): Promise<BaseInstanceType<T>> {
  if (date == null) {
    return date;
  }
  return parseISO(date) as BaseInstanceType<T>;
}

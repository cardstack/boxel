import { format, parseISO } from 'date-fns';
import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export const datetimeFormat = `yyyy-MM-dd'T'HH:mm`;

export function queryableValue(date: Date | undefined) {
  if (date) {
    return format(date, datetimeFormat);
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

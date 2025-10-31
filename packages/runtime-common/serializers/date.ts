import { parse, format } from 'date-fns';
import type {
  BaseDefConstructor,
  BaseInstanceType,
} from 'https://cardstack.com/base/card-api';

export const dateFormat = `yyyy-MM-dd`;

export function queryableValue(date: Date | undefined) {
  if (date) {
    return format(date, dateFormat);
  }
  return undefined;
}

export function serialize(date: Date) {
  return format(date, dateFormat);
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  date: any,
): Promise<BaseInstanceType<T>> {
  if (date == null) {
    return date;
  }
  return parse(date, dateFormat, new Date()) as BaseInstanceType<T>;
}

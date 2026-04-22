import { DefAst } from '../../../parser/AST.js';
import {
  collectValues,
  generateItems,
  Item,
  ItemIterator,
} from '../../utils/utils.js';

export type NativeFilter = (input: Item, ...args: Item[]) => ItemIterator;
export type BareNativeFilter = (
  input: any,
  ...args: any[]
) => IterableIterator<any>;

export function wrapBareNativeFilters(
  impls: Record<string, BareNativeFilter>
): Record<string, NativeFilter> {
  return Object.fromEntries(
    Object.entries(impls).map(([key, bareFilter]) => {
      return [
        key,
        (input: Item, ...args: Item[]) =>
          generateItems(bareFilter(input.value, ...collectValues(args))),
      ];
    })
  );
}

export function isNativeFilter(
  val: DefAst | NativeFilter
): val is NativeFilter {
  return typeof val === 'function';
}

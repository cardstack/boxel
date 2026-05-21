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

export interface WrappedBareNativeFilter extends NativeFilter {
  bareNativeFilter: BareNativeFilter;
}

export function getBareNativeFilter(
  filter: NativeFilter,
): BareNativeFilter | undefined {
  return (filter as Partial<WrappedBareNativeFilter>).bareNativeFilter;
}

export function wrapBareNativeFilters(
  impls: Record<string, BareNativeFilter>
): Record<string, NativeFilter> {
  return Object.fromEntries(
    Object.entries(impls).map(([key, bareFilter]) => {
      const wrapped = ((input: Item, ...args: Item[]) =>
        generateItems(
          bareFilter(input.value, ...collectValues(args)),
        )) as WrappedBareNativeFilter;
      wrapped.bareNativeFilter = bareFilter;
      return [
        key,
        wrapped,
      ];
    })
  );
}

export function isNativeFilter(
  val: DefAst | NativeFilter
): val is NativeFilter {
  return typeof val === 'function';
}

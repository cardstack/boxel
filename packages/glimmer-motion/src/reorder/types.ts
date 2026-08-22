import type { Box, Point } from 'motion-utils';

export type ReorderAxis = 'x' | 'y' | 'xy';

/** React's ReorderContext — here the object <ReorderGroup> yields to its block */
export interface ReorderContextProps<T> {
  axis: ReorderAxis;
  registerItem: (item: T, layout: Box) => void;
  updateOrder: (item: T, offset: Point, velocity: Point) => void;
  groupRef: { current: Element | null };
}

export interface ItemData<T> {
  value: T;
  layout: Box;
}

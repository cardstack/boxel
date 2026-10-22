import type { Box, Point } from 'motion-utils';

export type ReorderAxis = 'x' | 'y' | 'xy';

/** React's ReorderContext — here the object <ReorderGroup> yields to its block */
export interface ReorderContextProps<T> {
  axis: ReorderAxis;
  groupRef: { current: Element | null };
  registerItem: (item: T, layout: Box) => void;
  updateOrder: (item: T, offset: Point, velocity: Point) => void;
}

export interface ItemData<T> {
  layout: Box;
  value: T;
}

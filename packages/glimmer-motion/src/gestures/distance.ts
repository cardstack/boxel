// @ts-nocheck — vendored verbatim; type-checked upstream under Motion's tsconfig
// Vendored from Motion's packages/framer-motion/src/utils/distance.ts (motion@bbabb00) — framework-free; only imports were re-pointed.
import type { Point } from 'motion-utils';

export const distance = (a: number, b: number) => Math.abs(a - b);

export function distance2D(a: Point, b: Point): number {
  // Multi-dimensional
  const xDelta = distance(a.x, b.x);
  const yDelta = distance(a.y, b.y);
  return Math.sqrt(xDelta ** 2 + yDelta ** 2);
}

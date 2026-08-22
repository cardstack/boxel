import { frame, microtask } from 'motion-dom';

/** the same helpers framer-motion's own suite uses */
export const nextFrame = () => new Promise<void>((resolve) => frame.postRender(() => resolve()));
export const nextMicrotask = () => new Promise<void>((resolve) => microtask.postRender(() => resolve()));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** a jest.fn() stand-in */
export function spy<A extends unknown[] = unknown[]>() {
  const calls: A[] = [];
  const fn = ((...args: A) => { calls.push(args); }) as ((...args: A) => void) & { calls: A[] };
  fn.calls = calls;
  return fn;
}

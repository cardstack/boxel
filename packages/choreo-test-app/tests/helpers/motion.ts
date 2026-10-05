import { frame } from 'motion-dom';

/** the same helpers Motion's own suite uses */
export const nextFrame = () =>
  new Promise<void>((resolve) => frame.postRender(() => resolve()));
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

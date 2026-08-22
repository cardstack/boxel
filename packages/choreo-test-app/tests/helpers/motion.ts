import { frame, microtask } from 'motion-dom';

/** the same helpers Motion's own suite uses */
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

/** Motion's jest.setup pointer helpers, as real PointerEvents (enter/leave are buttonless mouse events) */
const pointer = (type: string, init: PointerEventInit) => new PointerEvent(type, { bubbles: !/enter|leave/.test(type), cancelable: true, composed: true, ...init });
export const pointerEnter = (el: Element, init: PointerEventInit = {}) => el.dispatchEvent(pointer('pointerenter', { pointerType: 'mouse', button: -1, ...init }));
export const pointerLeave = (el: Element, init: PointerEventInit = {}) => el.dispatchEvent(pointer('pointerleave', { pointerType: 'mouse', button: -1, ...init }));
export const pointerDown = (el: Element, init: PointerEventInit = {}) => el.dispatchEvent(pointer('pointerdown', { isPrimary: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, ...init }));
export const pointerUp = (el: Element, init: PointerEventInit = {}) => el.dispatchEvent(pointer('pointerup', { isPrimary: true, pointerId: 1, pointerType: 'mouse', button: 0, ...init }));
export const focusEl = (el: Element) => { (el as HTMLElement).focus(); el.dispatchEvent(new FocusEvent('focus')); };
export const blurEl = (el: Element) => { (el as HTMLElement).blur(); el.dispatchEvent(new FocusEvent('blur')); };
export const keyDown = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
export const keyUp = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));

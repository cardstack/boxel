/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cancel, schedule } from '@ember/runloop';
import { Timer } from '@ember/runloop';

const cancellation: WeakMap<
  Promise<any>,
  (p: Promise<any>) => void
> = new WeakMap();

export function registerCancellation(
  promise: Promise<any>,
  handler: (p: Promise<any>) => void,
) {
  cancellation.set(promise, handler);
}

export function afterRender() {
  let ticket: Timer;
  let promise = new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    ticket = schedule('afterRender', resolve);
  });
  registerCancellation(promise, () => {
    cancel(ticket);
  });
  return promise;
}

export function microwait() {
  return new Promise<void>((resolve) => resolve());
}

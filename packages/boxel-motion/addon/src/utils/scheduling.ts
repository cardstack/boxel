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
    // eslint-disable-next-line ember/no-runloop
    ticket = schedule('afterRender', resolve);
  });
  registerCancellation(promise, () => {
    // eslint-disable-next-line ember/no-runloop
    cancel(ticket);
  });
  return promise;
}

export function microwait() {
  return new Promise<void>((resolve) => resolve());
}

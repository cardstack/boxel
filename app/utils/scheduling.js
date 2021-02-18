import { schedule, cancel } from '@ember/runloop';

const cancellation = new WeakMap();

function registerCancellation(promise, handler) {
  cancellation.set(promise, handler);
}

export function afterRender() {
  let ticket;
  let promise = new Promise((resolve) => {
    ticket = schedule('afterRender', resolve);
  });
  registerCancellation(promise, () => {
    cancel(ticket);
  });
  return promise;
}

export function microwait() {
  return new Promise((resolve) => resolve());
}

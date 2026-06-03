// Test-waiter plumbing for code that runs inside the card sandbox (e.g. base
// card defs and shared runtime-common utilities), which cannot import
// `@ember/test-waiters` directly. The host test setup injects the real
// implementation once via `useTestWaiters`; outside of tests (and before
// injection) everything here is a no-op so production code is unaffected.

export interface Waiters {
  buildWaiter(label: string): {
    beginAsync(): unknown;
    endAsync(token: unknown): void;
  };
  waitForPromise<T>(promise: Promise<T>, label?: string): Promise<T>;
}

let injectedWaiters: Waiters | undefined;

export function useTestWaiters(w: Waiters) {
  injectedWaiters = w;
}

export interface TestWaiter {
  beginAsync(): unknown;
  endAsync(token: unknown): void;
}

// Returns a waiter whose real `@ember/test-waiters` backing is resolved lazily.
// This lets modules build their waiter at import time (before the host has had
// a chance to inject the real implementation) without registering a stray
// waiter in production.
export function buildWaiter(label: string): TestWaiter {
  let real: ReturnType<Waiters['buildWaiter']> | undefined;
  let resolve = () => {
    if (!real && injectedWaiters) {
      real = injectedWaiters.buildWaiter(label);
    }
    return real;
  };
  return {
    beginAsync() {
      return resolve()?.beginAsync();
    },
    endAsync(token: unknown) {
      if (token === undefined) {
        return;
      }
      resolve()?.endAsync(token);
    },
  };
}

export function waitForPromise<T>(
  promise: Promise<T>,
  label?: string,
): Promise<T> {
  if (injectedWaiters) {
    return injectedWaiters.waitForPromise(promise, label);
  }
  return promise;
}

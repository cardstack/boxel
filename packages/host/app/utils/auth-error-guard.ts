import { CardError, isCardError } from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';

const EVENT_NAME = 'boxel-auth-error';

export interface AuthErrorGuard {
  register(): void;
  unregister(): void;
  race<T>(promiseFactory: () => Promise<T>): Promise<T>;
  isAuthError(err: unknown): err is Error & { status?: number };
}

export function createAuthErrorGuard(
  target: EventTarget | undefined = typeof window !== 'undefined'
    ? window
    : undefined,
): AuthErrorGuard {
  const FLAG = Symbol('boxel-auth-error');
  let inFlight = new Set<Deferred<never>>();
  let listening = false;

  let handler = (event: Event) => {
    if (inFlight.size === 0) {
      return;
    }
    let detail =
      'detail' in event ? (event as CustomEvent).detail : (event as any).detail;
    let error = coerceAuthError(detail);
    (error as any)[FLAG] = true;
    for (let deferred of inFlight) {
      deferred.reject(error);
    }
    inFlight.clear();
  };

  function register() {
    if (listening || !target?.addEventListener) {
      return;
    }
    target.addEventListener(EVENT_NAME, handler);
    listening = true;
  }

  function unregister() {
    if (!listening || !target?.removeEventListener) {
      inFlight.clear();
      listening = false;
      return;
    }
    target.removeEventListener(EVENT_NAME, handler);
    inFlight.clear();
    listening = false;
  }

  async function race<T>(promiseFactory: () => Promise<T>): Promise<T> {
    let deferred = new Deferred<never>();
    inFlight.add(deferred);
    try {
      return await Promise.race([promiseFactory(), deferred.promise]);
    } finally {
      inFlight.delete(deferred);
    }
  }

  function isAuthError(err: unknown): err is Error & { status?: number } {
    return Boolean(err && typeof err === 'object' && (err as any)[FLAG]);
  }

  return {
    register,
    unregister,
    race,
    isAuthError,
  };
}

function coerceAuthError(detail: unknown): CardError {
  if (detail instanceof Error) {
    if (isCardError(detail)) {
      return detail;
    }
    let error = new CardError(detail.message, {
      status: (detail as any).status ?? 401,
    });
    error.stack = detail.stack;
    return error;
  }
  let status =
    detail && typeof detail === 'object' && 'status' in detail
      ? Number((detail as any).status)
      : 401;
  let message =
    typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as any).message)
        : 'Authorization error while logging into realm';
  let error = new CardError(message, { status });
  if (
    detail &&
    typeof detail === 'object' &&
    Array.isArray((detail as any).deps)
  ) {
    error.deps = (detail as any).deps;
  }
  return error;
}

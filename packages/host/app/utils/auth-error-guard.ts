import {
  CardError,
  isCardError,
  type FetcherMiddlewareHandler,
} from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';

export const AUTH_ERROR_EVENT_NAME = 'boxel-auth-error';
const AUTH_STATUSES = new Set([401, 403]);

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
  const FLAG = Symbol(AUTH_ERROR_EVENT_NAME);
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
    target.addEventListener(AUTH_ERROR_EVENT_NAME, handler);
    listening = true;
  }

  function unregister() {
    if (!listening || !target?.removeEventListener) {
      inFlight.clear();
      listening = false;
      return;
    }
    target.removeEventListener(AUTH_ERROR_EVENT_NAME, handler);
    inFlight.clear();
    listening = false;
  }

  async function race<T>(promiseFactory: () => Promise<T>): Promise<T> {
    let deferred = new Deferred<never>();
    inFlight.add(deferred);
    try {
      let result = await Promise.race([promiseFactory(), deferred.promise]);
      if (result instanceof Response && isAuthStatus(result.status)) {
        let error: CardError;
        try {
          error = await CardError.fromFetchResponse(result.url, result.clone());
        } catch {
          error = new CardError(
            result.statusText || 'Authorization error while logging into realm',
            { status: result.status },
          );
        }
        (error as any)[FLAG] = true;
        throw error;
      }
      return result;
    } finally {
      inFlight.delete(deferred);
    }
  }

  function isAuthError(err: unknown): err is Error & { status?: number } {
    if (!err || typeof err !== 'object') {
      return false;
    }
    if ((err as any)[FLAG]) {
      return true;
    }
    let status = (err as any).status;
    return typeof status === 'number' && isAuthStatus(status);
  }

  return {
    register,
    unregister,
    race,
    isAuthError,
  };
}

export function authErrorEventMiddleware(
  target: EventTarget | undefined = typeof window !== 'undefined'
    ? window
    : undefined,
): FetcherMiddlewareHandler {
  return async (req, next) => {
    let response = await next(req);
    if (isAuthStatus(response.status)) {
      dispatchAuthError(
        await CardError.fromFetchResponse(req.url, response.clone()),
        target,
      );
    }
    return response;
  };
}

export function dispatchAuthError(
  detail: unknown,
  target: EventTarget | undefined = typeof window !== 'undefined'
    ? window
    : undefined,
) {
  if (!target?.dispatchEvent) {
    return;
  }
  target.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT_NAME, { detail }));
}

function isAuthStatus(status?: number): boolean {
  return typeof status === 'number' && AUTH_STATUSES.has(status);
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

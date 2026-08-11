import type { FetcherMiddlewareHandler } from './fetcher.ts';

export interface TokenSource {
  token(url: string): string | undefined;
  reauthenticate(realmURL: string): Promise<string | undefined>;
}

/**
 * Let an explicitly interactive operation recover a realm session even when
 * an unrelated render has set the tab-wide render-context marker. The depth
 * counter makes nested and overlapping operations restore one another safely.
 */
export async function withReauthenticationAllowed<T>(
  callback: () => Promise<T>,
): Promise<T> {
  let globals = globalThis as {
    __boxelInteractiveRenderContextDepth?: number;
  };
  globals.__boxelInteractiveRenderContextDepth =
    (globals.__boxelInteractiveRenderContextDepth ?? 0) + 1;
  try {
    return await callback();
  } finally {
    let remainingDepth =
      (globals.__boxelInteractiveRenderContextDepth ?? 1) - 1;
    if (remainingDepth > 0) {
      globals.__boxelInteractiveRenderContextDepth = remainingDepth;
    } else {
      delete globals.__boxelInteractiveRenderContextDepth;
    }
  }
}

export function shouldSkipReauthenticationForContext({
  inRenderContext,
  interactiveRenderContextDepth,
  isBrowserTestEnv,
}: {
  inRenderContext: boolean;
  interactiveRenderContextDepth: number;
  isBrowserTestEnv: boolean;
}): boolean {
  return (
    inRenderContext && interactiveRenderContextDepth <= 0 && !isBrowserTestEnv
  );
}

function shouldSkipReauthentication(): boolean {
  try {
    let globals = globalThis as {
      __boxelRenderContext?: unknown;
      __boxelInteractiveRenderContextDepth?: unknown;
      QUnit?: unknown;
    };
    let inRenderContext = Boolean(globals.__boxelRenderContext);
    let interactiveRenderContextDepth =
      typeof globals.__boxelInteractiveRenderContextDepth === 'number'
        ? globals.__boxelInteractiveRenderContextDepth
        : 0;
    // Host tests also run the indexer and the app in the same js runtime which
    // can be very confusing. We err on the side of host tests needing
    // reauthentication retries enabled so browser-loaded assets can recover
    // from transient 401s.
    let isBrowserTestEnv =
      typeof window !== 'undefined' && Boolean(globals.QUnit);
    return shouldSkipReauthenticationForContext({
      inRenderContext,
      interactiveRenderContextDepth,
      isBrowserTestEnv,
    });
  } catch {
    return false;
  }
}

export function authorizationMiddleware(
  tokenSource: TokenSource,
): FetcherMiddlewareHandler {
  return async function (req, next) {
    let token = tokenSource.token(req.url);
    if (token) {
      req.headers.set('Authorization', token);
    }
    let response = await next(req);

    let realmURL = response.headers.get('x-boxel-realm-url');
    if (realmURL) {
      if (
        // Only 401 should attempt reauthentication. A 403 typically means the
        // caller is authenticated but not permitted, so reauth would be noisy
        // and not expected to succeed.
        response.status === 401 &&
        !shouldSkipReauthentication() &&
        !req.url.startsWith(`${realmURL}_session`)
      ) {
        token = await tokenSource.reauthenticate(realmURL);
        if (token) {
          req.headers.set('Authorization', token);
          response = await next(req);
        }
      }
    }
    return response;
  };
}

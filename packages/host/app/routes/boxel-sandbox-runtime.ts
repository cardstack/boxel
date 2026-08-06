import Route from '@ember/routing/route';

export interface BoxelSandboxRuntimeModel {
  bootstrapId: string;
  parentOrigin: string;
}

// Duplicated from router.ts's `path:` for this route (not imported from
// there — that would pull the whole route map into instance-initializer
// code that must decide before routing has even started). Keep the two in
// sync if this route's path ever changes.
const SANDBOX_RUNTIME_PATH = '/_boxel-sandbox-runtime';

/**
 * True when the app's current URL is the Sandbox child's own bootstrap
 * route. Callable at instance-initializer time — before the Router has
 * matched anything — since it reads `window.location` directly, exactly
 * the URL the browser just navigated the iframe to.
 *
 * Boot-time gates elsewhere in the app (matrix/realm/session start —
 * see `instance-initializers/register-auth-service-worker.ts`) consult
 * this: the Sandbox child boots the full host application inside a
 * credentialless, cross-origin iframe (RP-15.3), where matrix login,
 * `document.requestStorageAccess()`, and realm/sliding-sync network calls
 * are neither available nor needed — this route's own authority arrives
 * entirely over one transferred `MessagePort` (`sandbox-runtime-host.ts`).
 *
 * Deliberately a substring check, not `pathname === SANDBOX_RUNTIME_PATH`:
 * a deployment's `rootURL` (an Ember app can be served under a base path)
 * would prefix the served pathname, and strict equality would silently stop
 * matching — defeating the whole gate without any visible failure. The
 * route segment itself is a distinctive, collision-unlikely token, so a
 * substring match is specific enough without needing to know this app
 * instance's actual `rootURL`.
 */
export function isBoxelSandboxRuntimeBoot(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.pathname.includes(SANDBOX_RUNTIME_PATH)
  );
}

/** Inert child entry point. All authority arrives over one transferred port. */
export default class BoxelSandboxRuntimeRoute extends Route {
  model(): BoxelSandboxRuntimeModel {
    if (window.parent === window) {
      throw new Error('The Boxel Sandbox runtime must run inside an iframe');
    }
    let parameters = new URL(globalThis.location.href).searchParams;
    let bootstrapId = parameters.get('bootstrapId');
    let parentOrigin = parameters.get('parentOrigin');
    if (!bootstrapId || !parentOrigin) {
      throw new Error('The Boxel Sandbox bootstrap is incomplete');
    }
    let parsedParent = new URL(parentOrigin);
    if (parsedParent.origin !== parentOrigin) {
      throw new Error('The Boxel Sandbox parent origin is invalid');
    }
    if (parsedParent.origin === globalThis.location.origin) {
      throw new Error('The Boxel Sandbox requires a distinct parent origin');
    }
    // Breadcrumb 1/7: the route matched and its model resolved. The vite
    // client log reaches this (the child page connects to the same dev
    // server), so this and the breadcrumbs downstream of it turn "never
    // reaches render" into "stops exactly at X".
    console.warn('[sandbox-child] route model resolved', {
      bootstrapId,
      parentOrigin,
      pathname: window.location.pathname,
    });
    return { bootstrapId, parentOrigin };
  }
}

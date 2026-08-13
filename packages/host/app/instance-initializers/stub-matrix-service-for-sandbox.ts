import type ApplicationInstance from '@ember/application/instance';
import Service from '@ember/service';

import { isBoxelSandboxRuntimeBoot } from '../routes/boxel-sandbox-runtime';

/**
 * Registered in place of the real MatrixService for the Sandbox child's own
 * app instance only (see `initialize` below) — before anything has a chance
 * to look up `service:matrix-service`.
 *
 * Why a stub rather than gating every consumer: the Sandbox child boots the
 * full host application inside a credentialless, cross-origin iframe
 * (RP-15.3). `register-auth-service-worker.ts` gates its OWN eager
 * `matrix-service` lookup on the same Sandbox-boot check, but that turned
 * out not to be the only eager trigger — `ClientTelemetryService`'s
 * constructor unconditionally calls `start()`, which reads
 * `this.matrixService.userId`, lazily constructing the real MatrixService
 * anyway. Its constructor immediately starts `loadState` (requestStorageAccess
 * → matrix SDK load), which is neither available nor needed here. Gating
 * every present and future such consumer individually is a whack-a-mole:
 * this stub instead wins the lookup race for the whole app instance, so it
 * doesn't matter which consumer looks it up first.
 *
 * Every property read on an instance of this bare `Service` subclass
 * resolves to `undefined` — the same shape a genuinely absent/not-yet-loaded
 * matrix session already degrades to in consumers written for a lazy
 * dependency (`matrixService.userId ?? null`, `isLoggedIn` boolean checks:
 * `undefined` reads correctly as falsy). A consumer that calls an actual
 * matrix METHOD against this stub throws a clear, named TypeError instead of
 * silently no-op'ing — that would be new, unaudited matrix usage reachable
 * from the sandboxed render path, worth surfacing rather than papering over.
 */
export class SandboxMatrixServiceStub extends Service {}

export function initialize(appInstance: ApplicationInstance): void {
  if (!isBoxelSandboxRuntimeBoot()) {
    return;
  }
  appInstance.register('service:matrix-service', SandboxMatrixServiceStub);
}

export default {
  initialize,
  // Must win the registration race: `.register()` throws once a key has
  // already been resolved. Ordered before every other instance-initializer
  // that could (directly or transitively) be the first to look up
  // matrix-service, rather than relying on file-discovery order.
  before: [
    'register-auth-service-worker',
    'register-client-telemetry',
    'register-html-to-markdown',
    'dedupe-theme-styles',
    'export-application-global',
    'legacy-tool-service-alias',
  ],
};

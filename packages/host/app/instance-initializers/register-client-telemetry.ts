import type ApplicationInstance from '@ember/application/instance';
import { registerDestructor } from '@ember/destroyable';

import type ClientTelemetryService from '../services/client-telemetry';

// Boot the client-telemetry instrument eagerly at app boot so its passive
// timing observers (long-animation-frame, main-thread heartbeat) are running
// before the first card load, rather than lazily on first injection. The
// service self-gates (off under tests / prerender / unsupported browsers), so
// this lookup is a cheap no-op in those environments.
export function initialize(appInstance: ApplicationInstance): void {
  // Skip the eager lookup inside a prerender tab — the render path is hot and
  // the service would refuse to arm there anyway.
  if ((globalThis as { __boxelRenderContext?: unknown }).__boxelRenderContext) {
    return;
  }
  let telemetry = appInstance.lookup('service:client-telemetry') as
    | ClientTelemetryService
    | undefined;
  if (!telemetry) {
    return;
  }
  // Flush and release observers on app-instance teardown. The service also
  // registers its own destructor; teardown() is idempotent so the two are
  // safe together regardless of destruction order.
  registerDestructor(appInstance, () => telemetry.teardown());
}

export default {
  initialize,
};

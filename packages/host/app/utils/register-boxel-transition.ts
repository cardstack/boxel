import { registerDestructor } from '@ember/destroyable';
import type RouterService from '@ember/routing/router-service';

// Capability contract with the prerender drivers. A pooled page pins
// whatever host build it loaded, and the host and the prerender server
// deploy independently, so the driver probes this per page (alongside its
// per-visit auth/job stamping) before choosing a render strategy the host
// must understand. Stamped in this module because the pool bootstraps every
// page through the standby route, which evaluates it before the driver's
// first transition can run. `fusedIndexMeta`: render options carrying both
// `cardRender` and `fileExtract` produce a single render.meta payload that
// includes the file-extract result; a page without the flag gets one
// transition per pass instead.
(globalThis as any).__boxelHostCapabilities = {
  ...(globalThis as any).__boxelHostCapabilities,
  fusedIndexMeta: true,
};

export function registerBoxelTransitionTo(
  router: RouterService,
  owner: object,
): void {
  let transitionFn = (...args: Parameters<RouterService['transitionTo']>) => {
    router.transitionTo(...args);
  };
  (globalThis as any).boxelTransitionTo = transitionFn;
  registerDestructor(owner, () => {
    if ((globalThis as any).boxelTransitionTo === transitionFn) {
      delete (globalThis as any).boxelTransitionTo;
    }
  });
}

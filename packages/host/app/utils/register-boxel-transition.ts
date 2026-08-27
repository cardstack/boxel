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

// The card id of the most recent render transition requested through
// `boxelTransitionTo`, recorded synchronously at request time — before Ember
// begins the transition — so it survives every failure mode the router can
// produce. A pre-model throw rejects the transition while its RouteInfo
// params can still be unresolved (observed on the production build; the
// dev/test build resolves them earlier), and the page URL is still the
// standby page, so this stash can be the only surviving record of which card
// an error doc's deps must name.
export function recordAttemptedRenderCardId(
  routeName: unknown,
  firstParam: unknown,
): void {
  if (
    typeof routeName !== 'string' ||
    !(routeName === 'render' || routeName.startsWith('render.'))
  ) {
    return;
  }
  // Only a full render entry carries the card id in first position; sub-route
  // transitions that reuse established base params lead with format/level.
  if (typeof firstParam === 'string' && /^https?:\/\//.test(firstParam)) {
    (globalThis as any).__boxelLastAttemptedRenderCardId = firstParam;
  }
}

export function lastAttemptedRenderCardId(): string | undefined {
  let id = (globalThis as any).__boxelLastAttemptedRenderCardId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function registerBoxelTransitionTo(
  router: RouterService,
  owner: object,
): void {
  let transitionFn = (...args: Parameters<RouterService['transitionTo']>) => {
    recordAttemptedRenderCardId(args[0], args[1]);
    router.transitionTo(...args);
  };
  (globalThis as any).boxelTransitionTo = transitionFn;
  registerDestructor(owner, () => {
    if ((globalThis as any).boxelTransitionTo === transitionFn) {
      delete (globalThis as any).boxelTransitionTo;
    }
  });
}

import { registerDestructor } from '@ember/destroyable';
import type RouterService from '@ember/routing/router-service';

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

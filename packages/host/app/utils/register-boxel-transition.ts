import type RouterService from '@ember/routing/router-service';

export function registerBoxelTransitionTo(router: RouterService): void {
  (globalThis as any).boxelTransitionTo = (
    ...args: Parameters<RouterService['transitionTo']>
  ) => {
    router.transitionTo(...args);
  };
}

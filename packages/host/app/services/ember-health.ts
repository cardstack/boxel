import { schedule } from '@ember/runloop';
import Service from '@ember/service';

/**
 * Lightweight probe to determine if Ember's runloop is still responsive
 * after a window-level error. Schedules into 'afterRender' and waits a
 * short timeout; if the callback runs, Ember is considered healthy.
 */
export default class EmberHealthService extends Service {
  async isResponsive(timeout = 300): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const start = performance.now();
      const finish = (alive: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(alive);
        }
      };
      const to = window.setTimeout(() => finish(false), timeout);

      try {
        schedule('afterRender', () => {
          // If afterRender runs but only after the timeout window has elapsed,
          // consider Ember unresponsive for our purposes.
          const elapsed = performance.now() - start;
          clearTimeout(to);
          finish(elapsed <= timeout);
        });
      } catch {
        clearTimeout(to);
        finish(false);
      }
    });
  }
}

declare module '@ember/service' {
  interface Registry {
    'ember-health': EmberHealthService;
  }
}

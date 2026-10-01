import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { beginCrossing } from 'test-app/lib/crossing';

/**
 * Gallery card ⇄ demo page, as one crossing.
 *
 * This file used to be 435 lines of View Transition orchestration — the
 * veil, the paired snapshot layers, the paused page, the polled ending, and
 * the thirteen load-bearing subtleties they needed. The transition belongs
 * to the library now: `<Choreo @route>` in the application template treats
 * the route swap as one render pass, and its timeline says the whole move.
 * The region stays router-agnostic by design (docs/choreo-constructs.md §9),
 * so the one thing left for the route layer is telling the app a crossing
 * has begun — see app/lib/crossing.ts.
 */
export default class ApplicationRoute extends Route {
  @service declare router: RouterService;

  constructor(owner: Owner) {
    super(owner);
    this.router.on('routeWillChange', beginCrossing);
    registerDestructor(this, () => {
      this.router.off('routeWillChange', beginCrossing);
    });
  }
}

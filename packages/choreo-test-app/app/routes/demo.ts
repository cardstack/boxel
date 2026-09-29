import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { setMotionSpeed } from 'glimmer-motion';
import { findDemo } from 'test-app/lib/catalog';

export default class DemoRoute extends Route {
  @service declare router: RouterService;

  model(params: { demo_id: string }) {
    const demo = findDemo(params.demo_id);
    if (!demo) {
      void this.router.replaceWith('index');
      return;
    }
    return demo;
  }

  /**
   * The scroll belongs to the crossing now: the <Choreo @route> region
   * places the window INSIDE the pass — after the swap renders, before
   * final bounds are measured — for every arrival, the pager's included,
   * and it does so even at tempo zero. Scrolling here as well would move
   * the page under a crossing that has already measured it.
   */
  afterModel() {
    // the clock is global, so it goes back to normal with every demo — a stage
    // with no speed control must never be left mysteriously slow
    setMotionSpeed(1);
  }
}

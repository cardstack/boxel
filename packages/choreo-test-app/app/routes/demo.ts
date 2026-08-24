import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { schedule } from '@ember/runloop';
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
   * The pager keeps you in this route, so nothing resets the scroll: a new
   * demo starts at the top rather than wherever the last one was.
   *
   * Arriving from the gallery is the exception — the shared-element transition
   * in routes/application.ts owns the scroll for that, because it has to
   * happen INSIDE the snapshot. Scrolling here as well would move the page
   * under a transition that has already measured it.
   */
  afterModel(_model: unknown, transition: Transition) {
    // the clock is global, so it goes back to normal with every demo — a stage
    // with no speed control must never be left mysteriously slow
    setMotionSpeed(1);
    if (transition.from?.name === 'index') {
      return;
    }
    // eslint-disable-next-line ember/no-runloop -- see the import
    schedule('afterRender', () => window.scrollTo(0, 0));
  }
}

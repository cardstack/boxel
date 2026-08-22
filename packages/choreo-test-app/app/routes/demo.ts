import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';
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

  /** the pager keeps you in this route, so nothing resets the scroll: a new
   *  demo should start at the top rather than wherever the last one was */
  afterModel() {
    // eslint-disable-next-line ember/no-runloop -- see the import
    schedule('afterRender', () => window.scrollTo(0, 0));
  }
}

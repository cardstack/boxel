import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';
import { animateView } from 'glimmer-motion';

export default class ApplicationRoute extends Route {
  @service declare router: RouterService;
  private wrapping = false;

  constructor(owner: Owner) {
    super(owner);
    this.router.on('routeWillChange', this.wrap);
    registerDestructor(this, () => {
      this.router.off('routeWillChange', this.wrap);
    });
  }

  wrap = (transition: Transition) => {
    if (this.wrapping || transition.isAborted || !transition.from) {
      return;
    }
    transition.abort();
    this.wrapping = true;
    void Promise.resolve(
      animateView(async () => {
        await transition.retry();
      })
        .add('.topbar')
        .add('.page')
    ).finally(() => {
      this.wrapping = false;
    });
  };
}

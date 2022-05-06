import Component from '@glimmer/component';
import { inject as service } from '@ember/service';
import { action } from '@ember/object';
import RouterService from '@ember/routing/router-service';

interface MotionCardArgs {
  identifier: number;
}

export default class MotionCard extends Component<MotionCardArgs> {
  @service router!: RouterService;

  @action
  handleClick(): void {
    let name = this.router.currentRouteName;

    if (name === 'motion-study.index') {
      this.router.transitionTo('motion-study.details', this.args.identifier);
    } else {
      this.router.transitionTo('motion-study.index');
    }
  }
}

import Service from '@ember/service';

import { scheduleOnce } from '@ember/runloop';

export default class AnimationsService extends Service {
  contexts = new Set();

  possiblyFarMatchingSprites = new Set();

  registerContext(context) {
    this.contexts.add(context);
    scheduleOnce('afterRender', this, 'handleFarMatching');

    console.log('registered the context', context.args.id);
  }

  unregisterContext(context) {
    console.log('will remove the context', context.args.id);
    context.registered.forEach(s => this.possiblyFarMatchingSprites.add(s));

    this.contexts.delete(context);
  }

  handleFarMatching() {
    console.log('handleFarMatching');

    this.contexts.forEach(context =>
      context.handleFarMatching(this.possiblyFarMatchingSprites)
    );

    this.possiblyFarMatchingSprites.clear();
  }
}

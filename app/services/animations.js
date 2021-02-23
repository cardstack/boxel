import Service from '@ember/service';

import { scheduleOnce } from '@ember/runloop';

export default class AnimationsService extends Service {
  contexts = new Set();

  possiblyFarMatchingSpriteModifiers = new Set();

  registerContext(context) {
    this.contexts.add(context);
    scheduleOnce('afterRender', this, 'handleFarMatching');
  }

  unregisterContext(context) {
    context.registered.forEach((s) =>
      this.possiblyFarMatchingSpriteModifiers.add(s)
    );
    this.contexts.delete(context);
  }

  notifyRemovedSpriteModifier(spriteModifier) {
    this.possiblyFarMatchingSpriteModifiers.add(spriteModifier);
    scheduleOnce('afterRender', this, 'handleFarMatching');
  }

  handleFarMatching() {
    console.log('AnimationsService#handleFarMatching()');
    this.contexts.forEach((context) =>
      context.handleFarMatching(this.possiblyFarMatchingSpriteModifiers)
    );

    this.possiblyFarMatchingSpriteModifiers.clear();
  }
}

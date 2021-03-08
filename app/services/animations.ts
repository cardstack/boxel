import Service from '@ember/service';

import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';

export default class AnimationsService extends Service {
  spriteTree = new SpriteTree();
  freshlyAdded: Set<SpriteModifier> = new Set();
  freshlyRemoved: Set<SpriteModifier> = new Set();
  eligibleContexts: Set<AnimationContext> = new Set();

  registerContext(context: AnimationContext): void {
    this.spriteTree.addAnimationContext(context);
  }

  unregisterContext(context: AnimationContext): void {
    this.spriteTree.removeAnimationContext(context);
  }

  registerSpriteModifier(spriteModifier: SpriteModifier): void {
    this.spriteTree.addSpriteModifier(spriteModifier);
    this.freshlyAdded.add(spriteModifier);
  }

  unregisterSpriteModifier(spriteModifier: SpriteModifier): void {
    this.spriteTree.removeSpriteModifier(spriteModifier);
    this.freshlyRemoved.add(spriteModifier);
  }

  notifyContextRendering(animationContext: AnimationContext): void {
    this.eligibleContexts.add(animationContext);
    scheduleOnce('afterRender', this, this.maybeTransition);
  }

  maybeTransition(): void {
    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    for (let context of contexts) {
      let transitionRunner = new TransitionRunner(
        context as AnimationContext,
        this
      );
      let task = taskFor(transitionRunner.maybeTransitionTask);
      task.perform();
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    animations: AnimationsService;
  }
}

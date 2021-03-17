import Service from '@ember/service';

import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import Changeset from '../models/changeset';

export default class AnimationsService extends Service {
  spriteTree = new SpriteTree();
  freshlyAdded: Set<SpriteModifier> = new Set();
  freshlyRemoved: Set<SpriteModifier> = new Set();
  eligibleContexts: Set<AnimationContext> = new Set();
  intent: string | undefined;

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

  async maybeTransition(): Promise<void> {
    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    let promises = [];
    for (let context of contexts) {
      let transitionRunner = new TransitionRunner(context as AnimationContext, {
        spriteTree: this.spriteTree,
        freshlyAdded: this.freshlyAdded,
        freshlyRemoved: this.freshlyRemoved,
        intent: this.intent,
      });
      let task = taskFor(transitionRunner.maybeTransitionTask);
      promises.push(task.perform());
    }
    await Promise.allSettled(promises);
    this.freshlyAdded.clear();
    this.freshlyRemoved.clear();
    this.spriteTree.clearFreshlyRemovedChildren();
    this.intent = undefined;
  }

  setIntent(intentDescription: string): void {
    this.intent = intentDescription;
  }

  notifyTransition(
    changeset: Changeset,
    animationContext: AnimationContext
  ): void {
    alert('here');
  }
}

declare module '@ember/service' {
  interface Registry {
    animations: AnimationsService;
  }
}

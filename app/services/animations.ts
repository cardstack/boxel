import Service from '@ember/service';

import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import Sprite from '../models/sprite';
import Motion from '../motions/base';
import { SpriteAnimation } from '../models/sprite-animation';

export type AnimateFunction = (
  sprite: Sprite,
  motion: Motion
) => SpriteAnimation;
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
    let el1 = document.querySelector('div.ball');
    console.log('1', el1?.getBoundingClientRect(), el1?.getAnimations());

    document.querySelectorAll('div.ball').forEach((el) => {
      el.getAnimations().forEach((a) => a.pause());
    });

    if (document.querySelectorAll('div.ball').length === 2) {
      debugger;
    }

    if (el1) {
      let activeAnimations = el1?.getAnimations();
      activeAnimations[0]?.pause();
      console.log(
        'active animation rect',
        activeAnimations[0],
        el1.getBoundingClientRect()
      );
    }

    scheduleOnce('afterRender', this, this.maybeTransition);
    console.log(
      '2',
      document.querySelectorAll('div.ball')[1]?.getBoundingClientRect()
    );
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
}

declare module '@ember/service' {
  interface Registry {
    animations: AnimationsService;
  }
}

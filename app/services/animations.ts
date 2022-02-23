import Service from '@ember/service';

import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree, { SpriteTreeNodeType } from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import Sprite from '../models/sprite';
import Motion from '../motions/base';
import { SpriteAnimation } from '../models/sprite-animation';
import Changeset from 'animations/models/changeset';
import { copyComputedStyle } from 'animations/utils/measurement';
import { assert } from '@ember/debug';
import SpriteFactory from 'animations/models/sprite-factory';

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
  currentChangesets: Changeset[] = [];
  animatingSprites: WeakMap<AnimationContext, Sprite[]> = new WeakMap();

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

  _notifiedContextRendering = new Set();
  notifyContextRendering(animationContext: AnimationContext): void {
    if (!this._notifiedContextRendering.has(animationContext)) {
      this._notifiedContextRendering.add(animationContext);
      this.eligibleContexts.add(animationContext);

      // we can't schedule this, if we don't deal with it immediately the animations will already be gone
      this.willTransition(animationContext);

      scheduleOnce('afterRender', this, this.maybeTransition);
    }
  }

  filterToContext(
    animationContext: AnimationContext,
    spriteModifiers: Set<SpriteModifier>,
    opts = { includeFreshlyRemoved: false }
  ): Set<SpriteModifier> {
    let contextDescendants = this.spriteTree.descendantsOf(
      animationContext,
      opts
    );
    let result = new Set(
      [...spriteModifiers].filter((m) => contextDescendants.includes(m))
    );
    return result;
  }

  // TODO: as this is called once per context, we could probably pass the context as an argument and forego the loop
  willTransition(context: AnimationContext): void {
    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    console.log('willTransition', contexts);

    // TODO: what about intents

    let contextNodeChildren = this.spriteTree.lookupNodeByElement(
      context.element
    )?.children;

    let animatingSprites: Sprite[] = [];
    if (contextNodeChildren) {
      for (let contextNodeChild of contextNodeChildren) {
        if (contextNodeChild.nodeType === SpriteTreeNodeType.Sprite) {
          let spriteModifier = contextNodeChild.model as SpriteModifier;

          // TODO: animations already need to be paused here
          let sprite = SpriteFactory.createIntermediateSprite(spriteModifier);

          // TODO: we could leave these measurements to the SpriteFactory as they are unique to the SpriteType
          if (sprite.element.getAnimations().length) {
            let bounds = sprite.captureAnimatingBounds(context.element);
            let styles = copyComputedStyle(sprite.element); // TODO: check if we need to pause the animation
            console.log(styles['background-color']);
            sprite.initialBounds = bounds;
            sprite.initialComputedStyle = styles;
            animatingSprites.push(sprite);
          }
        }
      }
    }

    assert(
      'Context already present in animatingSprites',
      !this.animatingSprites.has(context)
    );
    this.animatingSprites.set(context, animatingSprites);
  }

  async maybeTransition(): Promise<void> {
    this._notifiedContextRendering.clear();

    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    let animatingSprites = this.animatingSprites;
    this.animatingSprites = new WeakMap();
    console.log('maybeTransition', contexts, animatingSprites);
    let promises = [];
    for (let context of contexts as AnimationContext[]) {
      let transitionRunner = new TransitionRunner(context as AnimationContext, {
        spriteTree: this.spriteTree,
        freshlyAdded: this.freshlyAdded,
        freshlyRemoved: this.freshlyRemoved,
        intent: this.intent,
        animatingSprites: animatingSprites.get(context),
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

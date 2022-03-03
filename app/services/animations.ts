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
import {
  all,
  didCancel,
  restartableTask,
  TaskInstance,
} from 'ember-concurrency';

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
  intermediateSprites: WeakMap<AnimationContext, Sprite[]> = new WeakMap();

  registerContext(context: AnimationContext): void {
    this.spriteTree.addAnimationContext(context);
  }

  unregisterContext(context: AnimationContext): void {
    this.eligibleContexts.delete(context);
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

  // When we interrupt, we can clean certain sprites marked for garbage collection
  cleanupSprites(context: AnimationContext): void {
    let removedSprites = this.filterToContext(context, this.freshlyRemoved, {
      includeFreshlyRemoved: true,
    });

    // cleanup removedSprites
    removedSprites.forEach((sm) => {
      if (sm.element.getAttribute('data-sprite-hidden') === 'true') {
        if (context.hasOrphan(sm.element as HTMLElement)) {
          context.removeOrphan(sm.element as HTMLElement);
        }
        this.freshlyRemoved.delete(sm);
      }
    });
  }

  // TODO: as this is called once per context, we could probably pass the context as an argument and forego the loop
  willTransition(context: AnimationContext): void {
    console.log('willTransition', context);

    // TODO: what about intents

    this.cleanupSprites(context);

    let spriteModifiers: Set<SpriteModifier> = this.filterToContext(
      context,
      this.freshlyRemoved,
      { includeFreshlyRemoved: true }
    );

    // TODO: we only look at direct descendants here, not all
    let contextNodeChildren = this.spriteTree.lookupNodeByElement(
      context.element
    )?.children;
    if (contextNodeChildren) {
      for (let child of contextNodeChildren) {
        if (child.nodeType === SpriteTreeNodeType.Sprite) {
          spriteModifiers.add(child.model as SpriteModifier);
        }
      }
    }

    let intermediateSprites: Sprite[] = [];
    for (let spriteModifier of spriteModifiers) {
      let sprite = SpriteFactory.createIntermediateSprite(spriteModifier);

      // TODO: we could leave these measurements to the SpriteFactory as they are unique to the SpriteType
      let bounds = sprite.captureAnimatingBounds(context.element);
      let styles = copyComputedStyle(sprite.element); // TODO: check if we need to pause the animation, is so we want to integrate this with captureAnimatingBounds to only pause/play once.
      // console.log(styles['background-color']);
      sprite.initialBounds = bounds;
      sprite.initialComputedStyle = styles;
      intermediateSprites.push(sprite);
    }

    assert(
      'Context already present in intermediateSprites',
      !this.intermediateSprites.has(context)
    );
    this.intermediateSprites.set(context, intermediateSprites);
  }

  async maybeTransition(): Promise<TaskInstance<void>> {
    return taskFor(this.maybeTransitionTask)
      .perform()
      .catch((error) => {
        if (!didCancel(error)) {
          console.error(error);
          throw error;
        } else {
          console.warn('maybeTransition cancelled, animations interrupted');
        }
      });
  }

  @restartableTask
  *maybeTransitionTask() {
    this._notifiedContextRendering.clear();

    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    let intermediateSprites = this.intermediateSprites;
    this.intermediateSprites = new WeakMap();

    let promises = [];
    for (let context of contexts as AnimationContext[]) {
      // TODO: Should we keep a "current" transition runner while it is running so we can actually interrupt it?
      //  It may also be good enough to rewrite maybeTransition into a Task.
      let transitionRunner = new TransitionRunner(context as AnimationContext, {
        spriteTree: this.spriteTree,
        freshlyAdded: this.freshlyAdded,
        freshlyRemoved: this.freshlyRemoved,
        intent: this.intent,
        intermediateSprites: intermediateSprites.get(context),
      });
      let task = taskFor(transitionRunner.maybeTransitionTask);
      promises.push(task.perform());
    }
    yield all(promises);
    // TODO: check for async leaks
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

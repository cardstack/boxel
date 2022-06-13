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
import Changeset from 'animations-experiment/models/changeset';
import { copyComputedStyle } from 'animations-experiment/utils/measurement';
import { assert } from '@ember/debug';
import SpriteFactory from 'animations-experiment/models/sprite-factory';
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
  intermediateSprites: WeakMap<AnimationContext, Set<Sprite>> = new WeakMap();
  runningAnimations: Map<string, Set<Animation>> = new Map();

  registerContext(context: AnimationContext): void {
    this.spriteTree.addPendingAnimationContext(context);
  }

  unregisterContext(context: AnimationContext): void {
    this.eligibleContexts.delete(context);
    this.spriteTree.removeAnimationContext(context);
  }

  registerSpriteModifier(spriteModifier: SpriteModifier): void {
    this.spriteTree.addPendingSpriteModifier(spriteModifier);
    this.freshlyAdded.add(spriteModifier);
  }

  unregisterSpriteModifier(spriteModifier: SpriteModifier): void {
    this.spriteTree.removeSpriteModifier(spriteModifier);
    this.freshlyRemoved.add(spriteModifier);
  }

  didNotifyContextRendering = false;
  notifyContextRendering(animationContext: AnimationContext): void {
    this.eligibleContexts.add(animationContext);

    // Trigger willTransition once per render cycle
    if (!this.didNotifyContextRendering) {
      this.didNotifyContextRendering = true;

      // TODO: we are very likely doing too much measuring as this triggers measurements on all contexts.
      //  We (probably) only need to measure for sibling contexts (and their children).

      // TODO: it could be nice if we keep track of animations that we own in the sprites or contexts so we don't even need to look them up in the DOM
      // Lookup all animations at once so we only need to access the DOM once
      let animations = document.getAnimations();
      let playing = 0; // debug
      for (let animation of animations) {
        if (animation.playState === 'running') {
          playing++;
          animation.pause();
          let runningAnimation = this.runningAnimations.get(animation.id);
          if (runningAnimation) {
            runningAnimation.add(animation);
          } else {
            this.runningAnimations.set(animation.id, new Set([animation]));
          }
        }
      }
      console.info(
        `${animations.length} animations found in DOM, ${playing} were playing.`
      );

      for (let context of this.eligibleContexts) {
        // We can't schedule this, if we don't deal with it immediately the animations will already be gone
        this.willTransition(context);
      }
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

  willTransition(context: AnimationContext): void {
    // TODO: what about intents
    // TODO: it might be possible to only measure if we know something changed since last we measured.

    this.cleanupSprites(context);

    // We need to measure if this was an already rendered context in case the window has resized.
    // The element check is there because the renderDetector may fire this before the actual element exists.
    if (context.element) {
      context.captureSnapshot();
    }

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
        if (child.isSprite) {
          spriteModifiers.add(child.spriteModel as SpriteModifier);
        }
      }
    }

    let intermediateSprites: Set<Sprite> = new Set();
    for (let spriteModifier of spriteModifiers) {
      let sprite = SpriteFactory.createIntermediateSprite(spriteModifier);

      // We cannot know which animations we need to cancel until afterRender, so we will pause them so they don't
      // progress after we did our measurements.
      //sprite.element.getAnimations().forEach((a) => a.pause());
      // TODO: we could leave these measurements to the SpriteFactory as they are unique to the SpriteType
      let bounds = sprite.captureAnimatingBounds(context.element, false);
      let styles = copyComputedStyle(sprite.element);
      sprite.initialBounds = bounds;
      sprite.initialComputedStyle = styles;

      intermediateSprites.add(sprite);
    }

    assert(
      'Context already present in intermediateSprites',
      !this.intermediateSprites.has(context)
    );
    this.intermediateSprites.set(context, intermediateSprites);
  }

  async maybeTransition(): Promise<TaskInstance<void>> {
    this.spriteTree.flushPendingAdditions();

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
    this.didNotifyContextRendering = false;

    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    let intermediateSprites = this.intermediateSprites;
    let runningAnimations = this.runningAnimations;
    this.intermediateSprites = new WeakMap();
    this.runningAnimations = new Map();

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
        runningAnimations,
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

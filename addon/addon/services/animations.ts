import Service from '@ember/service';

import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree, { SpriteTreeNode } from '../models/sprite-tree';
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
import {
  filterToContext,
  SpriteSnapshotNodeBuilder,
} from 'animations-experiment/models/sprite-snapshot-node-builder';

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

  // When we interrupt, we can clean certain sprites marked for garbage collection
  cleanupSprites(context: AnimationContext): void {
    let removedSprites = filterToContext(
      this.spriteTree,
      context,
      this.freshlyRemoved,
      {
        includeFreshlyRemoved: true,
      }
    );

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

  createIntermediateSpritesForContext(context: AnimationContext) {
    // We do not care about "stableness of contexts here".
    // For intermediate sprites it is good enough to measure direct children only.

    let contextNode = this.spriteTree.nodesByElement.get(
      context.element
    ) as SpriteTreeNode;

    let freshlyRemovedSpriteNodes = [
      ...contextNode.freshlyRemovedChildren,
    ].filter(
      (node) =>
        node.spriteModel &&
        this.freshlyRemoved.has(node.spriteModel as SpriteModifier) // we have to filter by global freshlyRemoved as the SpriteTree can contain old removed sprites
    );
    let otherSpriteNodes = [...contextNode.children].filter(
      (node) => node.spriteModel
    );

    let spriteModifiers = new Set<SpriteModifier>(
      [...freshlyRemovedSpriteNodes, ...otherSpriteNodes].map(
        (n) => n.spriteModel as SpriteModifier
      )
    );

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
    return intermediateSprites;
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

    assert(
      'Context already present in intermediateSprites',
      !this.intermediateSprites.has(context)
    );
    this.intermediateSprites.set(
      context,
      this.createIntermediateSpritesForContext(context)
    );
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

    // This classifies sprites and puts them under the correct first stable ancestor context.
    let spriteSnapshotNodeBuilder = new SpriteSnapshotNodeBuilder(
      this.spriteTree,
      this.eligibleContexts,
      this.freshlyAdded,
      this.freshlyRemoved
    );

    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    let intermediateSprites = this.intermediateSprites;
    let runningAnimations = this.runningAnimations;
    this.intermediateSprites = new WeakMap();
    this.runningAnimations = new Map();

    let promises = [];
    for (let context of contexts as AnimationContext[]) {
      let spriteSnapshotNode =
        spriteSnapshotNodeBuilder.contextToNode.get(context);
      if (spriteSnapshotNode && spriteSnapshotNode.hasSprites) {
        let { insertedSprites, keptSprites, removedSprites } =
          spriteSnapshotNode;

        let changeset = new Changeset(context, undefined);
        changeset.addSprites([
          ...insertedSprites,
          ...keptSprites,
          ...removedSprites,
        ]);

        // TODO: add intermediateSprites

        let transitionRunner = new TransitionRunner(context);
        let task = taskFor(transitionRunner.maybeTransitionTask);
        promises.push(task.perform(changeset));
      }
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

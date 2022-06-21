import Service from '@ember/service';

import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree, { SpriteTreeNode } from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import Sprite, { SpriteIdentifier } from '../models/sprite';
import Motion from '../motions/base';
import { SpriteAnimation } from '../models/sprite-animation';
import Changeset from 'animations-experiment/models/changeset';
import {
  CopiedCSS,
  copyComputedStyle,
  getDocumentPosition,
} from 'animations-experiment/utils/measurement';
import { assert } from '@ember/debug';
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

export interface IntermediateSprite {
  modifier: SpriteModifier;
  intermediateBounds: DOMRect;
  intermediateStyles: CopiedCSS;
}

export default class AnimationsService extends Service {
  spriteTree = new SpriteTree();
  freshlyAdded: Set<SpriteModifier> = new Set();
  freshlyRemoved: Set<SpriteModifier> = new Set();
  eligibleContexts: Set<AnimationContext> = new Set();
  intent: string | undefined;
  intermediateSprites: Map<string, IntermediateSprite> = new Map();
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

    for (let node of [
      ...contextNode.freshlyRemovedChildren,
      ...contextNode.children,
    ]) {
      if (node.spriteModel && node.spriteModel.element.getAnimations().length) {
        let spriteModifier = node.spriteModel as SpriteModifier;
        let identifier = new SpriteIdentifier(
          spriteModifier.id,
          spriteModifier.role
        );
        let identifierString = identifier.toString();

        assert(
          `IntermediateSprite already exists for identifier ${identifierString}`,
          !this.intermediateSprites.has(identifierString)
        );

        this.intermediateSprites.set(identifierString, {
          modifier: spriteModifier,
          intermediateBounds: getDocumentPosition(
            spriteModifier.element as HTMLElement,
            {
              withAnimations: true,
              playAnimations: false,
            }
          ),
          intermediateStyles: copyComputedStyle(spriteModifier.element),
        });
      }
    }
  }

  willTransition(context: AnimationContext): void {
    // TODO: what about intents
    // TODO: it might be possible to only measure if we know something changed since last we measured.

    this.cleanupSprites(context);

    // We need to measure if this was an already rendered context in case the window has resized.
    // The element check is there because the renderDetector may fire this before the actual element exists.
    if (context.element) {
      context.captureSnapshot();
      this.createIntermediateSpritesForContext(context);
      let contextNode = this.spriteTree.nodesByElement.get(
        context.element
      ) as SpriteTreeNode;
      contextNode.freshlyRemovedChildren.clear();
    }
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
    this.didNotifyContextRendering = false;

    // Update the SpriteTree
    this.spriteTree.flushPendingAdditions();

    // This classifies sprites and puts them under the correct first stable ancestor context.
    let spriteSnapshotNodeBuilder = new SpriteSnapshotNodeBuilder(
      this.spriteTree,
      this.eligibleContexts,
      this.freshlyAdded,
      this.freshlyRemoved,
      this.intermediateSprites
    );

    // We can already do cleanup here so that we're guaranteed to have the
    // correct starting point for the next run even if an interruption happens.
    this.freshlyAdded.clear();
    this.freshlyRemoved.clear();
    this.intermediateSprites = new Map();
    this.runningAnimations = new Map();
    this.intent = undefined;

    // TODO: let runningAnimations = this.runningAnimations;

    let promises = [];
    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
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

        let transitionRunner = new TransitionRunner(context);
        let task = taskFor(transitionRunner.maybeTransitionTask);
        promises.push(task.perform(changeset));
      }
    }
    yield all(promises);
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

import Service from '@ember/service';

import SpriteTree, {
  IContext,
  ISpriteModifier,
  SpriteTreeNode,
} from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import Sprite, { SpriteIdentifier } from '../models/sprite';
import Motion from '../motions/base';
import { SpriteAnimation } from '../models/sprite-animation';
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
import { ChangesetBuilder } from 'animations-experiment/models/changeset';

export type AnimateFunction = (
  sprite: Sprite,
  motion: Motion
) => SpriteAnimation;

export default class AnimationsService extends Service {
  spriteTree = new SpriteTree();
  eligibleContexts: Set<IContext> = new Set();
  intent: string | undefined;
  runningAnimations: Map<string, Set<Animation>> = new Map();

  get freshlyAdded(): Set<ISpriteModifier> {
    return this.spriteTree.freshlyAdded;
  }

  get freshlyRemoved(): Set<ISpriteModifier> {
    return this.spriteTree.freshlyRemoved;
  }

  get interruptedRemoved(): Set<ISpriteModifier> {
    return this.spriteTree.interruptedRemoved;
  }

  registerContext(context: IContext): void {
    this.spriteTree.addPendingAnimationContext(context);
  }

  unregisterContext(context: IContext): void {
    this.eligibleContexts.delete(context);
    this.spriteTree.removeAnimationContext(context);
  }

  registerSpriteModifier(spriteModifier: ISpriteModifier): void {
    this.spriteTree.addPendingSpriteModifier(spriteModifier);
  }

  unregisterSpriteModifier(spriteModifier: ISpriteModifier): void {
    this.spriteTree.removeSpriteModifier(spriteModifier);
  }

  didNotifyContextRendering = false;
  notifyContextRendering(animationContext: IContext): void {
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

      let animationsToCancel: Animation[] = [];
      for (let context of this.eligibleContexts) {
        // We can't schedule this, if we don't deal with it immediately the animations will already be gone
        animationsToCancel = animationsToCancel.concat(
          this.willTransition(context)
        );
      }

      animationsToCancel.forEach((a) => a.cancel());
      scheduleOnce('afterRender', this, this.maybeTransition);
    }
  }

  cleanupSprites(_context: IContext): void {
    assert('Freshly removed is not empty', !this.freshlyRemoved.size);
    // TODO: When we interrupt, we can clean certain sprites marked for garbage collection
    // However, because we currently do cleanup in maybeTransitionTask, this method is a no-op because
    // freshlyRemoved should always be empty

    // let removedSprites = filterToContext(
    //   this.spriteTree,
    //   context,
    //   this.freshlyRemoved,
    //   {
    //     includeFreshlyRemoved: true,
    //   }
    // );

    // // cleanup removedSprites
    // removedSprites.forEach((sm) => {
    //   if (sm.element.getAttribute('data-sprite-hidden') === 'true') {
    //     if (context.hasOrphan(sm.element as HTMLElement)) {
    //       context.removeOrphan(sm.element as HTMLElement);
    //     }
    //     this.freshlyRemoved.delete(sm);
    //   }
    // });
  }

  captureBeforeRenderState(context: IContext) {
    context.captureSnapshot(true);
    // We do not care about "stableness of contexts here".
    // For intermediate sprites it is good enough to measure direct children only.

    let animationsToCancel: Animation[] = [];

    let contextNode = this.spriteTree.lookupNodeByElement(
      context.element
    ) as SpriteTreeNode;

    for (let { spriteModifier } of contextNode.getSpriteDescendants()) {
      let animations = spriteModifier.element.getAnimations() ?? [];
      animationsToCancel = animationsToCancel.concat(animations);
      if (
        animations?.length &&
        animations.some((v) => v.playState === 'running')
      ) {
        spriteModifier.captureSnapshot(true, {
          withAnimations: true,
          playAnimations: false,
        });
      } else {
        spriteModifier.captureSnapshot(true);
      }
    }

    return animationsToCancel;
  }

  willTransition(context: IContext): Animation[] {
    let animationsToCancel: Animation[] = [];
    // TODO: what about intents
    // TODO: it might be possible to only measure if we know something changed since last we measured.

    this.cleanupSprites(context);

    // We need to measure if this was an already rendered context in case the window has resized.
    // The element check is there because the renderDetector may fire this before the actual element exists.
    if (context.element) {
      animationsToCancel = this.captureBeforeRenderState(context);
      let contextNode = this.spriteTree.lookupNodeByElement(
        context.element
      ) as SpriteTreeNode;
      for (let {
        isRemoved,
        node,
        spriteModifier,
      } of contextNode.getSpriteDescendants()) {
        if (!isRemoved) continue;

        let identifier = new SpriteIdentifier(
          spriteModifier.id,
          spriteModifier.role
        ).toString();
        if (
          !context.orphans
            .get(identifier)
            ?.getAnimations()
            .some((v) => v.playState === 'running')
        ) {
          node.delete();
        } else {
          this.spriteTree.interruptedRemoved.add(spriteModifier);
        }
      }
    }

    return animationsToCancel;
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
    // this.spriteTree.log();

    // This classifies sprites and puts them under the correct first stable ancestor context.
    let changesetBuilder = new ChangesetBuilder(
      this.spriteTree,
      this.eligibleContexts,
      this.spriteTree.freshlyAdded,
      new Set([
        ...this.spriteTree.freshlyRemoved,
        ...this.spriteTree.interruptedRemoved,
      ])
    );

    // We can already do cleanup here so that we're guaranteed to have the
    // correct starting point for the next run even if an interruption happens.
    this.spriteTree.freshlyAdded.clear();
    this.spriteTree.freshlyRemoved.clear();
    this.spriteTree.interruptedRemoved.clear();
    this.runningAnimations = new Map();
    this.intent = undefined;

    // TODO: let runningAnimations = this.runningAnimations;

    let promises = [];
    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    for (let context of contexts) {
      let changeset = changesetBuilder.contextToChangeset.get(context);
      if (changeset && changeset.hasSprites) {
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

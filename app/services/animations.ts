import Service from '@ember/service';

import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree from '../models/sprite-tree';
import TransitionRunner from '../models/transition-runner';
import { scheduleOnce } from '@ember/runloop';
import { taskFor } from 'ember-concurrency-ts';
import Sprite, { SpriteType } from '../models/sprite';
import Motion from '../motions/base';
import { SpriteAnimation } from '../models/sprite-animation';
import Changeset from 'animations/models/changeset';
import { copyComputedStyle } from 'animations/utils/measurement';

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
      this.willTransition();

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

  willTransition(): void {
    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    console.log('willTransition', contexts);

    // TODO: what about intents

    // TODO: when interrupted we only need to deal with freshlyAdded/removed sprites
    // as those should be the only ones with animations in progress.

    // TODO: we need to create the changeset here already (and pass it as an argument to the TransitionRunner which will need to "diff" it & update finalbounds etc.)
    let changesets: Changeset[] = [];
    for (let context of contexts as AnimationContext[]) {
      let freshlyAdded = this.filterToContext(context, this.freshlyAdded);
      let freshlyRemoved = this.filterToContext(
        context as AnimationContext,
        this.freshlyRemoved,
        {
          includeFreshlyRemoved: true,
        }
      );
      // we don't need to do anything if there's no sprites
      if (freshlyAdded.size === 0 && freshlyRemoved.size === 0) {
        return;
      }

      let changeset = new Changeset(context, this.intent);
      changeset.addInsertedSprites(freshlyAdded);
      changeset.addRemovedSprites(freshlyRemoved);
      //changeset.addKeptSprites(this.freshlyChanged);
      changeset.finalizeSpriteCategories();
      changesets.push(changeset);
      console.warn('Interrupted changeset:');
      this.logChangeset(changeset, context);

      // TODO: pause animations,
      //  do measurements,
      //  store the changesets until maybeTransition,
      //  pass the changesets to the TransitionRunner

      let sprites = [
        ...changeset.insertedSprites,
        ...changeset.removedSprites,
        ...changeset.keptSprites,
      ];

      for (let sprite of sprites) {
        let activeAnimations = sprite.element.getAnimations();
        if (activeAnimations.length) {
          //let activeAnimation = activeAnimations[0];
          // TODO: we probably don't need to pause here already, the measurements also pause the animation
          //activeAnimation.pause();
          // TODO: do we even need to lock styles here? My guess is no.
          sprite.lockStyles(sprite.initialBounds?.relativeToContext);

          // TODO: this also pauses/plays the animation. Do we need to still pause ourselves for the lockStyles?
          let bounds = sprite.captureAnimatingBounds(context.element);
          let styles = copyComputedStyle(sprite.element);
          // initialBounds = bounds.relativeToContext;
          // initialVelocity = bounds.velocity;
          sprite.unlockStyles();

          // TODO: double check if this interferes with itself/anything as this code is triggered multiple times by glimmer
          //  it may simply be unnecessary to cancel as the element will be removed anyway
          // if we already measured this one it might simply not trigger the next time it is called though, because there's
          // no active animations on the element anymore. Just need to make sure we don't overwrite the changeset.
          //activeAnimation.cancel();

          //sprite.finalBounds = initialBounds.

          // TODO: what about the computedStyles, we might need to cache/pass those as well

          sprite.initialBounds = bounds;
          sprite.initialComputedStyle = styles;
        }
      }
    }

    this.currentChangesets = changesets;
  }

  async maybeTransition(): Promise<void> {
    this._notifiedContextRendering.clear();

    let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
    let currentChangesets = this.currentChangesets;
    this.currentChangesets = [];
    console.log('maybeTransition', contexts, currentChangesets);
    let promises = [];
    for (let context of contexts) {
      let interruptionChangeset = currentChangesets.find(
        (changeset) => changeset.context === context
      );
      let transitionRunner = new TransitionRunner(context as AnimationContext, {
        spriteTree: this.spriteTree,
        freshlyAdded: this.freshlyAdded,
        freshlyRemoved: this.freshlyRemoved,
        intent: this.intent,
        interruptionChangeset,
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

  // TODO: make a util out of this :-)
  private logChangeset(
    changeset: Changeset,
    animationContext: AnimationContext
  ): void {
    let contextId = animationContext.args.id;
    function row(type: SpriteType, sprite: Sprite) {
      return {
        intent: changeset.intent,
        context: contextId,
        type,
        spriteRole: sprite.role,
        spriteId: sprite.id,
        initialBounds: sprite.initialBounds
          ? JSON.stringify(sprite.initialBounds)
          : null,
        finalBounds: sprite.finalBounds
          ? JSON.stringify(sprite.finalBounds)
          : null,
      };
    }
    let tableRows = [];
    for (let type of [
      SpriteType.Inserted,
      SpriteType.Removed,
      SpriteType.Kept,
    ]) {
      for (let sprite of changeset.spritesFor({ type })) {
        tableRows.push(row(type, sprite));
      }
    }
    console.table(tableRows);
  }
}

declare module '@ember/service' {
  interface Registry {
    animations: AnimationsService;
  }
}

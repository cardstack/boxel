import Service from '@ember/service';

import { scheduleOnce } from '@ember/runloop';
import SpriteModifier from '../modifiers/sprite';
import SpriteTree from '../models/sprite-tree';
import AnimationContext from '../components/animation-context';
import { task } from 'ember-concurrency-decorators';
import { microwait } from '../utils/scheduling';
import Changeset from '../models/changeset';
import Sprite, { SpriteType } from '../models/sprite';

export default class AnimationsService extends Service {
  contexts: Set<AnimationContext> = new Set();
  spriteTree = new SpriteTree();
  freshlyAdded: Set<SpriteModifier> = new Set();
  freshlyRemoved: Set<SpriteModifier> = new Set();

  possiblyFarMatchingSpriteModifiers: Set<SpriteModifier> = new Set();

  registerContext(context: AnimationContext): void {
    this.contexts.add(context);
    this.spriteTree.addAnimationContext(context);
    scheduleOnce('afterRender', this, 'handleFarMatching');
  }

  unregisterContext(context: AnimationContext): void {
    let contextDescendants = this.spriteTree.descendantsOf(context);
    for (let contextDescendant of contextDescendants) {
      if (contextDescendant instanceof SpriteModifier) {
        let spriteModifier = contextDescendant as SpriteModifier;
        this.possiblyFarMatchingSpriteModifiers.add(spriteModifier);
      }
    }
    this.contexts.delete(context);
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

  notifyRemovedSpriteModifier(spriteModifier: SpriteModifier): void {
    this.possiblyFarMatchingSpriteModifiers.add(spriteModifier);
    scheduleOnce('afterRender', this, 'handleFarMatching');
  }

  handleFarMatching(): void {
    console.log('AnimationsService#handleFarMatching()');
    this.contexts.forEach((context) =>
      context.handleFarMatching(this.possiblyFarMatchingSpriteModifiers)
    );

    this.possiblyFarMatchingSpriteModifiers.clear();
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @task *maybeTransitionTask(animationContext: AnimationContext) {
    yield microwait(); // allow animations service to run far-matching to run first
    console.log(`AnimationContext(${animationContext.id})#maybeTransition()`);
    let contextDescendants = this.spriteTree.descendantsOf(animationContext);
    for (let contextDescendant of contextDescendants) {
      if (contextDescendant instanceof SpriteModifier) {
        let spriteModifier = contextDescendant as SpriteModifier;
        if (spriteModifier.checkForChanges()) {
          animationContext.freshlyChanged.add(spriteModifier);
        }
      }
    }
    if (animationContext.hasNoChanges) {
      return;
    }
    let changeset = new Changeset(animationContext);
    changeset.addInsertedAndReceivedSprites(
      animationContext.freshlyAdded,
      animationContext.farMatchCandidates
    );
    animationContext.freshlyAdded.clear();

    yield microwait(); // allow other contexts to do their far-matching for added sprites

    changeset.addRemovedAndSentSprites(animationContext.freshlyRemoved);
    animationContext.freshlyRemoved.clear();
    animationContext.farMatchCandidates.clear();

    changeset.addKeptSprites(animationContext.freshlyChanged);
    animationContext.freshlyChanged.clear();

    changeset.finalizeSpriteCategories();

    if (animationContext.shouldAnimate(changeset)) {
      this.logChangeset(changeset, animationContext); // For debugging
      let animation = animationContext.args.use?.(changeset);
      yield Promise.resolve(animation);
      let contextDescendants = this.spriteTree.descendantsOf(animationContext);
      for (let contextDescendant of contextDescendants) {
        if (contextDescendant instanceof SpriteModifier) {
          (contextDescendant as SpriteModifier).checkForChanges();
        }
      }
    }
    animationContext.isInitialRenderCompleted = true;
  }

  logChangeset(changeset: Changeset, animationContext: AnimationContext): void {
    let contextId = animationContext.args.id;
    function row(type: SpriteType, sprite: Sprite) {
      return {
        context: contextId,
        type,
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
      SpriteType.Sent,
      SpriteType.Received,
    ]) {
      for (let sprite of changeset.spritesFor(type)) {
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

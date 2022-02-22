import AnimationContext from 'animations/components/animation-context';
import { task } from 'ember-concurrency-decorators';
import Changeset from '../models/changeset';
import Sprite, { SpriteType } from '../models/sprite';
import SpriteTree from './sprite-tree';
import SpriteModifier from '../modifiers/sprite';
import ContextAwareBounds from 'animations/models/context-aware-bounds';
import { assert } from '@ember/debug';

function checkForChanges(
  spriteModifier: SpriteModifier,
  animationContext: AnimationContext
): boolean {
  spriteModifier.captureSnapshot();
  let spriteCurrent = spriteModifier.currentBounds;
  let spriteLast = spriteModifier.lastBounds;
  let contextCurrent = animationContext.currentBounds;
  let contextLast = animationContext.lastBounds;
  if (spriteCurrent && spriteLast && contextCurrent && contextLast) {
    let parentLeftChange = contextCurrent.left - contextLast.left;
    let parentTopChange = contextCurrent.top - contextLast.top;

    return (
      spriteCurrent.left - spriteLast.left - parentLeftChange !== 0 ||
      spriteCurrent.top - spriteLast.top - parentTopChange !== 0 ||
      spriteCurrent.width - spriteLast.width !== 0 ||
      spriteCurrent.height - spriteLast.height !== 0
    );
  }
  return true;
}

type TransitionRunnerOpts = {
  spriteTree: SpriteTree;
  freshlyAdded: Set<SpriteModifier>;
  freshlyRemoved: Set<SpriteModifier>;
  intent: string | undefined;
  interruptionChangeset: Changeset | undefined;
};
export default class TransitionRunner {
  animationContext: AnimationContext;
  spriteTree: SpriteTree;
  freshlyAdded: Set<SpriteModifier>;
  freshlyRemoved: Set<SpriteModifier>;
  intent: string | undefined;
  freshlyChanged: Set<SpriteModifier> = new Set();
  interruptionChangeset: Changeset | undefined;

  constructor(animationContext: AnimationContext, opts: TransitionRunnerOpts) {
    this.animationContext = animationContext;
    this.spriteTree = opts.spriteTree;
    this.freshlyAdded = opts.freshlyAdded;
    this.freshlyRemoved = opts.freshlyRemoved;
    this.intent = opts.intent;
    this.interruptionChangeset = opts.interruptionChangeset;
  }

  filterToContext(
    spriteModifiers: Set<SpriteModifier>,
    opts = { includeFreshlyRemoved: false }
  ): Set<SpriteModifier> {
    let contextDescendants = this.spriteTree.descendantsOf(
      this.animationContext,
      opts
    );
    let result = new Set(
      [...spriteModifiers].filter((m) => contextDescendants.includes(m))
    );
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @task *maybeTransitionTask() {
    let { animationContext } = this;
    animationContext.captureSnapshot();
    let contextDescendants = this.spriteTree.descendantsOf(animationContext);
    for (let contextDescendant of contextDescendants) {
      if (contextDescendant instanceof SpriteModifier) {
        let spriteModifier = contextDescendant as SpriteModifier;
        if (checkForChanges(spriteModifier, animationContext)) {
          this.freshlyChanged.add(spriteModifier);
        }
      }
    }
    let freshlyAdded = this.filterToContext(this.freshlyAdded);
    let freshlyRemoved = this.filterToContext(this.freshlyRemoved, {
      includeFreshlyRemoved: true,
    });
    if (
      this.freshlyChanged.size === 0 &&
      freshlyAdded.size === 0 &&
      freshlyRemoved.size === 0
    ) {
      return;
    }
    let changeset = new Changeset(animationContext, this.intent);
    changeset.addInsertedSprites(freshlyAdded);
    changeset.addRemovedSprites(freshlyRemoved);
    changeset.addKeptSprites(this.freshlyChanged);
    changeset.finalizeSpriteCategories();

    if (this.interruptionChangeset) {
      let allInterruptedSprites = [
        ...this.interruptionChangeset.insertedSprites,
        ...this.interruptionChangeset.removedSprites,
        ...this.interruptionChangeset.keptSprites,
      ];
      for (let sprite of [
        ...changeset.insertedSprites,
        ...changeset.removedSprites,
        ...changeset.keptSprites,
      ]) {
        let interruptedSprite = allInterruptedSprites.find(
          (is) =>
            is.id === sprite.id &&
            is.role === sprite.role &&
            is.type === sprite.type // TODO: check if this equals method is good enough or too naive
        );

        // TODO: we might need to set the bounds on the counterpart of
        //  keptSprites only, not magically modify them for "new" sprites.

        if (interruptedSprite) {
          // TODO: fix this
          if (!interruptedSprite.initialBounds) {
            assert('interruptedSprite should always have initialBounds');
            return;
          }

          if (!sprite.initialBounds?.parent) {
            assert('sprite should always have initialBounds');
            return;
          }

          if (!sprite.counterpart) {
            assert('not implemented for cases without counterpart');
            console.error('not implemented for cases without counterpart');
          }

          assert(
            'sprite counterpart should always have initialBounds',
            sprite.counterpart?.initialBounds
          );

          // set the interrupted state as the initial state of the counterpart
          sprite.counterpart.initialBounds = new ContextAwareBounds({
            element: interruptedSprite.initialBounds.element,
            contextElement: sprite.counterpart.initialBounds.parent,
          });
          sprite.initialComputedStyle = interruptedSprite.initialComputedStyle;
        }
      }
    }

    if (animationContext.shouldAnimate(changeset)) {
      this.logChangeset(changeset, animationContext); // For debugging
      let animation = animationContext.args.use?.(changeset);
      try {
        yield Promise.resolve(animation);
      } catch (error) {
        console.error(error);
        throw error;
      }
      animationContext.clearOrphans();
      animationContext.captureSnapshot();
      let contextDescendants = this.spriteTree.descendantsOf(animationContext);
      for (let contextDescendant of contextDescendants) {
        if (contextDescendant instanceof SpriteModifier) {
          (contextDescendant as SpriteModifier).captureSnapshot();
        }
      }
    }
    animationContext.isInitialRenderCompleted = true;
  }

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

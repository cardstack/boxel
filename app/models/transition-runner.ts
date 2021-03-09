import AnimationContext from 'animations/components/animation-context';
import { task } from 'ember-concurrency-decorators';
import Changeset from '../models/changeset';
import Sprite, { SpriteType } from '../models/sprite';
import SpriteTree from './sprite-tree';
import SpriteModifier from '../modifiers/sprite';

function checkForChanges(
  spriteModifier: SpriteModifier,
  animationContext: AnimationContext
): boolean {
  spriteModifier.trackPosition();
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
};
export default class TransitionRunner {
  animationContext: AnimationContext;
  spriteTree: SpriteTree;
  freshlyAdded: Set<SpriteModifier>;
  freshlyRemoved: Set<SpriteModifier>;
  intent: string | undefined;
  freshlyChanged: Set<SpriteModifier> = new Set();

  constructor(animationContext: AnimationContext, opts: TransitionRunnerOpts) {
    this.animationContext = animationContext;
    this.spriteTree = opts.spriteTree;
    this.freshlyAdded = opts.freshlyAdded;
    this.freshlyRemoved = opts.freshlyRemoved;
    this.intent = opts.intent;
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
    console.log(`AnimationContext(${animationContext.id})#maybeTransition()`);
    animationContext.trackPosition();
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

    if (animationContext.shouldAnimate(changeset)) {
      this.logChangeset(changeset, animationContext); // For debugging
      let animation = animationContext.args.use?.(changeset);
      yield Promise.resolve(animation);
      animationContext.trackPosition();
      let contextDescendants = this.spriteTree.descendantsOf(animationContext);
      for (let contextDescendant of contextDescendants) {
        if (contextDescendant instanceof SpriteModifier) {
          (contextDescendant as SpriteModifier).trackPosition();
        }
      }
    } else {
      console.log('no transition', this);
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
      for (let sprite of changeset.spritesFor(type)) {
        tableRows.push(row(type, sprite));
      }
    }
    console.table(tableRows);
  }
}

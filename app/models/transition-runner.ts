import AnimationContext from 'animations/components/animation-context';
import { task } from 'ember-concurrency-decorators';
import { microwait } from '../utils/scheduling';
import Changeset from '../models/changeset';
import Sprite, { SpriteType } from '../models/sprite';
import SpriteTree from './sprite-tree';
import SpriteModifier from '../modifiers/sprite';

export default class TransitionRunner {
  animationContext: AnimationContext;
  spriteTree: SpriteTree;

  constructor(animationContext: AnimationContext, spriteTree: SpriteTree) {
    this.animationContext = animationContext;
    this.spriteTree = spriteTree;
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

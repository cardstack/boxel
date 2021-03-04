import AnimationContext from 'animations/components/animation-context';
import { task } from 'ember-concurrency-decorators';
import { microwait } from '../utils/scheduling';
import Changeset from '../models/changeset';
import Sprite, { SpriteType } from '../models/sprite';
import SpriteTree from './sprite-tree';
import SpriteModifier from '../modifiers/sprite';
import AnimationsService from '../services/animations';
export default class TransitionRunner {
  animationContext: AnimationContext;
  animations: AnimationsService;
  freshlyChanged: Set<SpriteModifier> = new Set();

  constructor(
    animationContext: AnimationContext,
    animationsService: AnimationsService
  ) {
    this.animationContext = animationContext;
    this.animations = animationsService;
  }

  get spriteTree(): SpriteTree {
    return this.animations.spriteTree;
  }

  get freshlyAdded(): Set<SpriteModifier> {
    return this.animations.freshlyAdded;
  }

  get freshlyRemoved(): Set<SpriteModifier> {
    return this.animations.freshlyRemoved;
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
  @task *maybeTransitionTask(animationContext: AnimationContext) {
    yield microwait(); // allow animations service to run far-matching to run first
    console.log(`AnimationContext(${animationContext.id})#maybeTransition()`);
    let contextDescendants = this.spriteTree.descendantsOf(animationContext);
    for (let contextDescendant of contextDescendants) {
      if (contextDescendant instanceof SpriteModifier) {
        let spriteModifier = contextDescendant as SpriteModifier;
        if (spriteModifier.checkForChanges()) {
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
    let changeset = new Changeset(animationContext);
    changeset.addInsertedAndReceivedSprites(
      freshlyAdded,
      animationContext.farMatchCandidates
    );
    for (let item of freshlyAdded) {
      this.freshlyAdded.delete(item);
    }

    yield microwait(); // allow other contexts to do their far-matching for added sprites

    changeset.addRemovedAndSentSprites(freshlyRemoved);
    for (let item of freshlyRemoved) {
      this.freshlyRemoved.delete(item);
    }
    animationContext.farMatchCandidates.clear();

    changeset.addKeptSprites(this.freshlyChanged);
    this.freshlyChanged.clear();

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

  private logChangeset(
    changeset: Changeset,
    animationContext: AnimationContext
  ): void {
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

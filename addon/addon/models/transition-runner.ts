import AnimationContext from 'animations-experiment/components/animation-context';
import { task } from 'ember-concurrency';
import Changeset from '../models/changeset';
import Sprite, { SpriteType } from '../models/sprite';

export default class TransitionRunner {
  animationContext: AnimationContext;
  intent: string | undefined;

  constructor(animationContext: AnimationContext) {
    this.animationContext = animationContext;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @task *maybeTransitionTask(changeset: Changeset) {
    let { animationContext } = this;

    // TODO: fix these
    //cancelInterruptedAnimations();
    //playUnrelatedAnimations();

    if (animationContext.shouldAnimate(changeset)) {
      this.spriteTree.log();
      this.logChangeset(changeset, animationContext); // For debugging
      let animation = animationContext.args.use?.(changeset);
      try {
        yield Promise.resolve(animation);
      } catch (error) {
        console.error(error);
        throw error;
      }
      animationContext.clearOrphans();
    }
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

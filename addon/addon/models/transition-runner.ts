import { task } from 'ember-concurrency';
import { Changeset } from '../models/changeset';
import Sprite, {
  MotionOptions,
  MotionProperty,
  SpriteType,
} from '../models/sprite';
import { assert } from '@ember/debug';
import { IContext } from './sprite-tree';
import { SpriteAnimation } from 'animations-experiment/models/sprite-animation';
import Behavior, { FPS } from 'animations-experiment/behaviors/base';
import { OrchestrationMatrix } from './orchestration-matrix';

export interface AnimationDefinition {
  timeline: AnimationTimeline;
}

export type AnimationTimeline =
  | SequentialAnimationTimeline
  | ParallelAnimationTimeline;
export interface SequentialAnimationTimeline {
  sequence: (MotionDefinition | AnimationTimeline)[];
  parallel: never;
}
export interface ParallelAnimationTimeline {
  parallel: (MotionDefinition | AnimationTimeline)[];
  sequence: never;
}

export interface MotionDefinition {
  sprites: Set<Sprite>;
  properties: {
    [k in MotionProperty]: MotionOptions | Record<string, never>;
  };
  timing: {
    behavior: Behavior;
    duration?: number;
    delay?: number;
  };
}

export default class TransitionRunner {
  animationContext: IContext;
  intent: string | undefined;

  constructor(animationContext: IContext) {
    this.animationContext = animationContext;
  }

  setupAnimations(definition: AnimationDefinition): SpriteAnimation[] {
    let timeline = definition.timeline;
    assert('No timeline present in AnimationDefinition', Boolean(timeline));
    assert(
      'Timeline can have either a sequence or a parallel definition, not both',
      !(timeline.sequence && timeline.parallel)
    );

    let orchestrationMatrix = OrchestrationMatrix.fromTimeline(timeline);
    let result: SpriteAnimation[] = [];
    for (let [sprite, keyframes] of orchestrationMatrix
      .getKeyframes((prev, incoming) => {
        return Object.assign({}, prev, ...incoming);
      })
      .entries()) {
      let duration = Math.max(0, (keyframes.length - 1) / FPS);
      let keyframeAnimationOptions = {
        easing: 'linear',
        duration,
      };

      let animation = new SpriteAnimation(
        sprite,
        keyframes,
        keyframeAnimationOptions
      );

      result.push(animation);
    }
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @task *maybeTransitionTask(changeset: Changeset) {
    assert('No changeset was passed to the TransitionRunner', !!changeset);

    let { animationContext } = this;

    // TODO: fix these
    //cancelInterruptedAnimations();
    //playUnrelatedAnimations();

    if (animationContext.shouldAnimate()) {
      this.logChangeset(changeset, animationContext); // For debugging
      let animationDefinition = animationContext.args.use?.(changeset) as
        | AnimationDefinition
        | undefined;

      if (animationDefinition) {
        // TODO: compile animation
        let animations = this.setupAnimations(animationDefinition);
        let promises = animations.map((animation) => animation.finished);

        animations.forEach((a) => {
          if (this.animationContext.hasOrphan(a.sprite)) {
            this.animationContext.removeOrphan(a.sprite);
          }
          if (a.sprite.type === SpriteType.Removed) {
            this.animationContext.appendOrphan(a.sprite);
            a.sprite.lockStyles();
          }
          a.play();
        });

        try {
          yield Promise.resolve(Promise.all(promises));
        } catch (error) {
          console.error(error);
          throw error;
        }
      }
      animationContext.clearOrphans();
    }
  }

  private logChangeset(changeset: Changeset, animationContext: IContext): void {
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

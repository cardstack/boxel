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

export interface AnimationDefinition {
  timeline: AnimationTimeline;
}

export interface AnimationTimeline {
  sequence?: MotionDefinition[];
  parallel?: MotionDefinition[];
}

export interface MotionDefinition {
  sprites: Set<Sprite>;
  properties: {
    [k in MotionProperty]: MotionOptions | {};
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

    let keyframesPerSprite = new Map<Sprite, Keyframe[]>();

    if (timeline.sequence) {
      for (let animation of timeline.sequence) {
        assert(
          'No sprites present on the animation definition',
          Boolean(animation.sprites?.size)
        );
        animation.sprites.forEach((sprite: Sprite) => {
          let keyframesForSprite = keyframesPerSprite.get(sprite);
          let delay = keyframesForSprite
            ? Math.max(0, (keyframesForSprite.length - 1) / FPS)
            : 0;

          Object.entries(animation.properties).forEach(
            ([property, options]) => {
              sprite.setupAnimation(property as MotionProperty, {
                ...options,
                ...animation.timing,
                // This relies on delay being implemented with no-op frames
                // If it's not, then we'll end up having overlapping effects from animation keyframes
                delay: delay + (animation.timing?.delay ?? 0),
              });
            }
          );
          // we pass the previous keyframes so the last values (if any) can be taken as a starting point if necessary
          // and/or velocity can be transferred
          let { keyframes } = sprite.compileCurrentAnimations() ?? {};

          if (keyframes?.length) {
            if (!keyframesPerSprite.has(sprite)) {
              keyframesPerSprite.set(sprite, keyframes);
            } else {
              let mergedKeyframes = keyframes.map((newKeyframe, index) => {
                let existingKeyframe = keyframesPerSprite.get(sprite)?.[index];

                // we let the existing keyframe override the new keyframe, because if we animated it already earlier
                // in the sequence the property will already be in the keyframe.
                return {
                  ...newKeyframe,
                  ...existingKeyframe,
                };
              });

              keyframesPerSprite.set(sprite, mergedKeyframes);
            }
          }
        });
      }
    } else if (timeline.parallel) {
      // TODO
    }

    return [...keyframesPerSprite.entries()].map(
      ([sprite, keyframes]: [Sprite, Keyframe[]]) => {
        // calculate "real" duration based on amount of keyframes at the given FPS
        let duration = Math.max(0, (keyframes.length - 1) / FPS);
        let keyframeAnimationOptions = {
          easing: 'linear',
          duration,
        };

        return new SpriteAnimation(sprite, keyframes, keyframeAnimationOptions);
      }
    );
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

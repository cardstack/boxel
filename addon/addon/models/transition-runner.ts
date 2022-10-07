import { task } from 'ember-concurrency';
import { Changeset } from '../models/changeset';
import Sprite, { MotionOptions, MotionProperty } from '../models/sprite';
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

  setupAnimations(definitions: AnimationDefinition[]): SpriteAnimation[] {
    let result: SpriteAnimation[] = [];

    let orchestrationMatrix = new OrchestrationMatrix();
    for (let definition of definitions) {
      let timeline = definition.timeline;
      assert('No timeline present in AnimationDefinition', Boolean(timeline));
      assert(
        'Timeline can have either a sequence or a parallel definition, not both',
        !(timeline.sequence && timeline.parallel)
      );

      orchestrationMatrix.add(0, OrchestrationMatrix.fromTimeline(timeline));
    }

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
      try {
        let animationDefinitions = [];
        if (animationContext.args.use instanceof Function) {
          // Note: some use() calls are async and return a Promise.
          // yielding this is currently incorrect (I think), because we probably don't want to
          // allow delaying animations by deferring the returning of an AnimationDefinition
          // TODO: Convert all current demos to use AnimationDefinition
          let animationDefinition: AnimationDefinition | undefined =
            (yield animationContext.args.use?.(changeset)) as
              | AnimationDefinition
              | undefined;

          if (animationDefinition) {
            animationDefinitions.push(animationDefinition);
          }
        }

        animationDefinitions = [
          ...changeset.animationDefinitions,
          ...animationDefinitions,
        ];

        if (animationDefinitions.length) {
          let animations = this.setupAnimations(animationDefinitions);
          let promises = animations.map((animation) => animation.finished);

          animations.forEach((a) => {
            a.play();
          });

          yield Promise.all(promises);
        }
      } catch (error) {
        console.error(error);
        throw error;
      }

      animationContext.clearOrphans();
    }
  }
}

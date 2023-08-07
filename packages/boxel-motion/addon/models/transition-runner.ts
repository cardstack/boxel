import { FPS } from '@cardstack/boxel-motion/behaviors/base';
import { SpriteAnimation } from '@cardstack/boxel-motion/models/sprite-animation';
import { Keyframe } from '@cardstack/boxel-motion/value';
import { Frame } from '@cardstack/boxel-motion/value/simple-frame';
import { assert } from '@ember/debug';
import { task } from 'ember-concurrency';

import Sprite, { SpriteType } from '../models/sprite';

import { IContext, Changeset } from './animator';

import { AnimationDefinition, OrchestrationMatrix } from './orchestration';

export function constructKeyframe(
  previousKeyframe: Partial<Keyframe>,
  frames: Frame[],
) {
  let keyframe: Keyframe = {};

  // This combines the individual transform properties that we support
  // into a single transform property in the specified order.
  let transformValues: { [k: string]: string[] } = {
    perspective: [],
    translateX: [],
    translateY: [],
    translateZ: [],
    rotate: [],
    rotateX: [],
    rotateY: [],
    rotateZ: [],
    scale: [],
    scaleX: [],
    scaleY: [],
    scaleZ: [],
    skew: [],
    skewX: [],
    skewY: [],
  };
  let transformTemplate = new Set(Object.keys(transformValues));
  frames.forEach((frame) => {
    if (transformTemplate.has(frame.property)) {
      transformValues[frame.property]!.push(frame.serializeValue() as string);
    } else {
      keyframe[frame.property] = frame.serializeValue();
    }
  });

  let transformStrings = Object.entries(transformValues).reduce(
    (result, [key, values]) => {
      result.push(...values.map((value) => `${key}(${value})`));
      return result;
    },
    [] as string[],
  );

  if (transformStrings.length) {
    keyframe['transform'] = transformStrings.join(' ');
  }

  return {
    ...previousKeyframe,
    ...keyframe,
  } as Keyframe;
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

    let orchestrationMatrix = OrchestrationMatrix.from(timeline);
    let result: SpriteAnimation[] = [];
    for (let [sprite, keyframes] of orchestrationMatrix
      .getKeyframes(constructKeyframe)
      .entries()) {
      let duration = Math.max(0, (keyframes.length - 1) / FPS);
      let keyframeAnimationOptions = {
        easing: 'linear',
        duration,
      };

      let animation = new SpriteAnimation(
        sprite,
        keyframes,
        keyframeAnimationOptions,
        sprite.callbacks.onAnimationStart,
      );

      result.push(animation);
    }
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  maybeTransitionTask = task(async (changeset: Changeset) => {
    assert('No changeset was passed to the TransitionRunner', !!changeset);

    let { animationContext } = this;

    // TODO: fix these
    //cancelInterruptedAnimations();
    //playUnrelatedAnimations();

    if (animationContext.shouldAnimate()) {
      this.logChangeset(changeset, animationContext); // For debugging
      let animationDefinition = animationContext.args.use?.(changeset);

      if (animationDefinition) {
        // TODO: compile animation
        let animations = this.setupAnimations(animationDefinition);
        let promises = animations.map((animation) => animation.finished);

        animations.forEach((a) => {
          if (a.sprite.type === SpriteType.Removed) {
            this.animationContext.appendOrphan(a.sprite);
            a.sprite.lockStyles();
          }
          a.play();
        });

        try {
          return Promise.resolve(Promise.all(promises));
        } catch (error) {
          console.error(error);
          throw error;
        }
      }
    }
  });

  private logChangeset(changeset: Changeset, animationContext: IContext): void {
    let contextId = animationContext.args.id;
    function row(type: SpriteType, sprite: Sprite) {
      return {
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

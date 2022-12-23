import Behavior, { FPS } from '@cardstack/boxel-motion/behaviors/base';

import StaticBehavior from '@cardstack/boxel-motion/behaviors/static';
import WaitBehavior from '@cardstack/boxel-motion/behaviors/wait';
import Sprite, {
  MotionOptions,
  MotionProperty,
} from '@cardstack/boxel-motion/models/sprite';
import generateFrames from '@cardstack/boxel-motion/utils/generate-frames';

import { Value, Keyframe } from '@cardstack/boxel-motion/value';
import { Frame } from '@cardstack/boxel-motion/value/simple-frame';
import { assert } from '@ember/debug';

interface RowFragment {
  startColumn: number;
  frames: Frame[];
  static: boolean;
}

export class OrchestrationMatrix {
  constructor(
    // This isn't ordered yet, but can be ordered if necessary
    public rows = new Map<Sprite, RowFragment[]>(),
    public totalColumns = 0
  ) {}

  // TODO: if we want to handle cascading effects, we'll need a way of iterating over this column-by-column,
  // in order of sprites from higher level in DOM to lower level, modifying scoped variables per-sprite
  // TODO: this can probably become a generator if we want?
  getKeyframes(
    constructKeyframe: (
      previousKeyframe: Partial<Keyframe>,
      frames: Frame[] // frame order may be relevant
    ) => Keyframe
  ) {
    let result: Map<Sprite, Keyframe[]> = new Map();
    for (let [sprite, rowFragments] of this.rows) {
      // convenience so we do less operations to determine active fragments
      let fragmentsByColumn: Record<number, RowFragment[]> = {};
      // examine assumptions - what exactly is the frame?
      let baseFrames = [];
      for (let rowFragment of rowFragments) {
        fragmentsByColumn[rowFragment.startColumn] =
          fragmentsByColumn[rowFragment.startColumn] ?? [];
        fragmentsByColumn[rowFragment.startColumn]!.push(rowFragment);
        // don't backfill static frames, they're intended to only be set for their duration
        if (rowFragment.static === false && rowFragment.frames[0]) {
          baseFrames.push(rowFragment.frames[0] as Frame);
        }
      }

      let baseKeyframe = constructKeyframe({}, baseFrames);
      let activeFragments: RowFragment[] = [];
      let keyframesForSprite: Keyframe[] = [];
      let previousKeyframe: Keyframe = baseKeyframe;
      let propertiesToRemoveFromPreviousKeyframe: string[] = [];
      for (let i = 0; i < this.totalColumns; i++) {
        if (fragmentsByColumn[i]) {
          activeFragments = activeFragments.concat(
            fragmentsByColumn[i] as RowFragment[]
          );
        }

        // TODO: This is (understatement) not ideal, we'll refactor later once we know the other requirements. It would
        //  be better if we could receive the previous frame as SimpleFrame instances, rather than a compiled keyframe.
        // TODO: this probably also doesn't work with `transform` (or other properties we give special treatment) since
        //  the frames will still contain the parts, rather than the compiled property.
        // Prevent static behaviors from being forward-filled
        previousKeyframe = Object.entries(previousKeyframe).reduce(
          (result, [key, value]) => {
            if (!propertiesToRemoveFromPreviousKeyframe.includes(key)) {
              result[key] = value;
            }
            return result;
          },
          {} as Keyframe
        );
        propertiesToRemoveFromPreviousKeyframe = [];

        let needsRemoval = false;
        let frames: Frame[] = [];
        for (let fragment of activeFragments) {
          let frame = fragment.frames.shift();
          if (frame) {
            frames.push(frame);

            // Detect the final frame for static behaviors, so we can exclude it from future frames (no forward-fill).
            if (!fragment.frames.length && fragment.static) {
              propertiesToRemoveFromPreviousKeyframe.push(frame.property);
            }
          } else needsRemoval = true;
        }
        let newKeyframe = constructKeyframe(previousKeyframe, frames);
        keyframesForSprite.push(newKeyframe);
        previousKeyframe = newKeyframe;

        if (needsRemoval) {
          activeFragments = activeFragments.filter(
            (rowFragment) => rowFragment.frames.length
          );
        }
      }

      result.set(sprite, keyframesForSprite);
    }
    return result;
  }

  add(col: number, matrix: OrchestrationMatrix) {
    for (let [sprite, rowFragments] of matrix.rows) {
      let incomingFragments = rowFragments.map((rowFragment) => {
        return {
          ...rowFragment,
          startColumn: rowFragment.startColumn + col,
        };
      });
      let existingFragments = this.rows.get(sprite);
      let newFragments = existingFragments
        ? existingFragments.concat(incomingFragments)
        : incomingFragments;
      this.rows.set(sprite, newFragments);
    }

    this.totalColumns = Math.max(this.totalColumns, matrix.totalColumns + col);
  }

  static empty() {
    return new OrchestrationMatrix();
  }

  static from(
    animationDefinitionPart: AnimationTimeline | MotionDefinition,
    maxLength?: number
  ): OrchestrationMatrix {
    if (isAnimationTimeline(animationDefinitionPart)) {
      if (animationDefinitionPart.type === 'sequence') {
        return OrchestrationMatrix.fromSequentialTimeline(
          animationDefinitionPart
        );
      } else {
        return OrchestrationMatrix.fromParallelTimeline(
          animationDefinitionPart
        );
      }
    } else {
      return OrchestrationMatrix.fromMotionDefinition(
        animationDefinitionPart,
        maxLength
      );
    }
  }

  static fromSequentialTimeline(
    timeline: AnimationTimeline
  ): OrchestrationMatrix {
    let timelineMatrix = OrchestrationMatrix.empty();
    for (let item of timeline.animations) {
      timelineMatrix.add(
        timelineMatrix.totalColumns,
        OrchestrationMatrix.from(item)
      );
    }
    return timelineMatrix;
  }

  static fromParallelTimeline(
    timeline: AnimationTimeline
  ): OrchestrationMatrix {
    let timelineMatrix = OrchestrationMatrix.empty();
    let submatrices = [];

    // TODO: sort timeline.animations to have `duration: 'infer'` at the end of the list.
    // maxLength is for anchoring to the end.
    let maxLength = 0;
    for (let item of timeline.animations) {
      // TODO: do we want a different option or more flexibility here? We could for example search for the longest
      //  non-inferred duration already compiled rather than picking the first one. Another option is to explicitly
      //  have to link to a MotionDefinition to infer from.
      let submatrix = OrchestrationMatrix.from(item, maxLength);

      maxLength = Math.max(maxLength, submatrix.totalColumns);
      submatrices.push(submatrix);
    }

    for (let submatrix of submatrices) {
      timelineMatrix.add(0, submatrix);
    }

    return timelineMatrix;
  }

  // We may not to rethink this bit if we want to be more clever about combining frames.
  // Possibly we do not want keyframes on this level yet, but only afterwards, and we
  // use the resulting OrchestrationMatrix to decide which values get merged/squished (i.e. transform).
  static fromMotionDefinition(
    motionDefinition: MotionDefinition,
    maxLength = 0
  ) {
    let properties = motionDefinition.properties;
    let timing = motionDefinition.timing;
    let rows = new Map<Sprite, RowFragment[]>();
    for (let sprite of motionDefinition.sprites) {
      let rowFragments: RowFragment[] = [];
      let startColumn = 0;

      if (timing.duration === 'infer') {
        assert(
          'No MotionDefinition to infer from found. Does your parallel timeline definition have MotionDefinition with an inferrible duration?',
          maxLength > 0
        );

        timing.duration = Math.max((maxLength - 1) / FPS, 0);
      }

      assert(
        'There is no MotionDefinition to anchor to',
        !(timing.anchor && maxLength === 0)
      );
      if (timing.anchor && maxLength) {
        if (timing.anchor === 'center') {
          startColumn =
            Math.round(maxLength / 2) - (timing!.duration! * FPS + 1);
        }

        if (timing.anchor === 'end') {
          startColumn = maxLength - (timing!.duration! * FPS + 1);
        }
      }

      if (timing.behavior instanceof WaitBehavior) {
        let frames = generateFrames(sprite, 'wait', {}, timing);
        if (frames?.length) {
          rowFragments.push({
            frames,
            startColumn,
            static: true,
          });
          maxLength = Math.max(frames.length, maxLength);
        }
      } else {
        for (let property in properties) {
          let options = properties[property as MotionProperty];

          if (options === undefined) {
            throw Error('Options cannot be undefined');
          }

          let frames = generateFrames(sprite, property, options, timing);

          if (frames?.length) {
            rowFragments.push({
              frames,
              startColumn,
              static: timing.behavior instanceof StaticBehavior,
            });
            maxLength = Math.max(frames.length, maxLength);
          }
        }
      }
      rows.set(sprite, rowFragments);
    }

    return new OrchestrationMatrix(rows, maxLength);
  }
}

export interface AnimationDefinition {
  timeline: AnimationTimeline;
}

export type AnimationTimeline = {
  type: 'sequence' | 'parallel';
  animations: (MotionDefinition | AnimationTimeline)[];
};

export interface MotionDefinition {
  sprites: Set<Sprite>;
  properties: {
    [k in MotionProperty]: MotionOptions | Value;
  };
  timing: {
    behavior: Behavior;
    duration?: number | 'infer';
    delay?: number;
    anchor?: 'start' | 'center' | 'end';
  };
}

function isAnimationTimeline(item: unknown): item is AnimationTimeline {
  return Boolean((item as AnimationTimeline).type);
}

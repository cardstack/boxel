import Behavior, { Frame } from '@cardstack/boxel-motion/behaviors/base';

import Sprite, { MotionOptions, MotionProperty } from './sprite';

interface RowFragment {
  startColumn: number;
  frames: Frame[];
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
      let baseKeyframe = {};
      for (let rowFragment of rowFragments) {
        fragmentsByColumn[rowFragment.startColumn] =
          fragmentsByColumn[rowFragment.startColumn] ?? [];
        fragmentsByColumn[rowFragment.startColumn]!.push(rowFragment);
        baseKeyframe = Object.assign({}, rowFragment.frames[0], baseKeyframe);
      }

      let activeFragments: RowFragment[] = [];
      let keyframesForSprite: Keyframe[] = [];
      let previousKeyframe = baseKeyframe;
      for (let i = 0; i < this.totalColumns; i++) {
        if (fragmentsByColumn[i]) {
          activeFragments = activeFragments.concat(
            fragmentsByColumn[i] as RowFragment[]
          );
        }

        let needsRemoval = false;
        let frames: Frame[] = [];
        for (let fragment of activeFragments) {
          let frame = fragment.frames.shift();
          if (frame) frames.push(frame);
          else needsRemoval = true;
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
    animationDefinitionPart: AnimationTimeline | MotionDefinition
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
      return OrchestrationMatrix.fromMotionDefinition(animationDefinitionPart);
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
    // maxLength is for anchoring to the end. not using yet
    // let maxLength = 0;
    for (let item of timeline.animations) {
      let submatrix = OrchestrationMatrix.from(item);

      // maxLength = Math.max(maxLength, submatrix.totalColumns);
      submatrices.push(submatrix);
    }

    for (let submatrix of submatrices) {
      timelineMatrix.add(0, submatrix);
    }

    return timelineMatrix;
  }

  static fromMotionDefinition(motionDefinition: MotionDefinition) {
    let properties = motionDefinition.properties;
    let timing = motionDefinition.timing;
    let rows = new Map<Sprite, RowFragment[]>();
    let maxLength = 0;
    for (let sprite of motionDefinition.sprites) {
      let rowFragments: RowFragment[] = [];
      for (let property in properties) {
        let options = properties[property as MotionProperty];
        sprite.setupAnimation(property as MotionProperty, {
          ...options,
          ...timing,
        });
        let { keyframes } = sprite.compileCurrentAnimations() ?? {};
        if (keyframes) {
          rowFragments.push({
            frames: keyframes as Frame[],
            startColumn: 0,
          });
          maxLength = Math.max(keyframes.length, maxLength);
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
    [k in MotionProperty]?: MotionOptions | Record<string, never>;
  };
  timing: {
    behavior: Behavior;
    duration?: number;
    delay?: number;
  };
}

function isAnimationTimeline(item: unknown): item is AnimationTimeline {
  return Boolean((item as AnimationTimeline).type);
}

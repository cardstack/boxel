import { Frame } from 'animations-experiment/behaviors/base';
import Sprite, { MotionProperty } from './sprite';
import {
  MotionDefinition,
  ParallelAnimationTimeline,
  SequentialAnimationTimeline,
} from './transition-runner';

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

  static fromTimeline(
    timeline: SequentialAnimationTimeline | ParallelAnimationTimeline
  ) {
    if ((timeline as SequentialAnimationTimeline).sequence) {
      return OrchestrationMatrix.fromSequentialTimeline(
        timeline as SequentialAnimationTimeline
      );
    } else if ((timeline as ParallelAnimationTimeline).parallel) {
      return OrchestrationMatrix.fromParallelTimeline(
        timeline as ParallelAnimationTimeline
      );
    } else {
      throw new Error(
        'Expected a timeline that was sequential or parallel, got neither'
      );
    }
  }

  static fromSequentialTimeline(
    timeline: SequentialAnimationTimeline
  ): OrchestrationMatrix {
    let timelineMatrix = OrchestrationMatrix.empty();
    let submatrices = [];
    for (let item of timeline.sequence) {
      let submatrix: OrchestrationMatrix;
      if ((item as SequentialAnimationTimeline).sequence) {
        submatrix = OrchestrationMatrix.fromSequentialTimeline(
          item as SequentialAnimationTimeline
        );
      } else if ((item as ParallelAnimationTimeline).parallel) {
        submatrix = OrchestrationMatrix.fromParallelTimeline(
          item as ParallelAnimationTimeline
        );
      } else {
        submatrix = OrchestrationMatrix.fromMotionDefinition(
          item as MotionDefinition
        );
      }

      submatrices.push(submatrix);
    }

    for (let submatrix of submatrices) {
      timelineMatrix.add(timelineMatrix.totalColumns, submatrix);
    }

    return timelineMatrix;
  }

  static fromParallelTimeline(
    timeline: ParallelAnimationTimeline
  ): OrchestrationMatrix {
    let timelineMatrix = OrchestrationMatrix.empty();
    let submatrices = [];
    // maxLength is for anchoring to the end. not using yet
    let maxLength = 0;
    for (let item of timeline.parallel) {
      let submatrix: OrchestrationMatrix;
      if ((item as SequentialAnimationTimeline).sequence) {
        submatrix = OrchestrationMatrix.fromSequentialTimeline(
          item as SequentialAnimationTimeline
        );
      } else if ((item as ParallelAnimationTimeline).parallel) {
        submatrix = OrchestrationMatrix.fromParallelTimeline(
          item as ParallelAnimationTimeline
        );
      } else {
        submatrix = OrchestrationMatrix.fromMotionDefinition(
          item as MotionDefinition
        );
      }

      maxLength = Math.max(maxLength, submatrix.totalColumns);
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

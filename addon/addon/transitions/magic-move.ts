import { Changeset } from '../models/changeset';
import { assert } from '@ember/debug';
import LinearBehavior from 'animations-experiment/behaviors/linear';
import approximatelyEqual from 'animations-experiment/utils/approximately-equal';
import Behavior from 'animations-experiment/behaviors/base';

export type TransitionOptions = {
  behavior?: Behavior;
  duration?: number;
  delay?: number;
};

/**
  Moves, scales and transforms kept sprites.

  @function magicMove
  @export default
*/
export default function (
  changeset: Changeset,
  options: TransitionOptions = {}
): void {
  let { keptSprites } = changeset;
  let { behavior = new LinearBehavior(), duration, delay } = options;

  for (let s of keptSprites) {
    assert(
      'kept sprite should always have initialBounds & finalBounds',
      s.initialBounds && s.finalBounds
    );
    let initialBounds = s.initialBounds.relativeToContext;
    let initialStyles = s.initialComputedStyle;
    let initialVelocity = s.initialBounds.velocity;

    // TODO "oldInitialBounds" when interrupting to calculate Tween duration proportionally

    if (s.counterpart) {
      // This is a Sprite that has changed places in the DOM
      let counterpart = s.counterpart;

      counterpart.hide();

      assert(
        'counterpart sprite should always have initialBounds',
        counterpart.initialBounds
      );

      initialBounds = counterpart.initialBounds.relativeToContext;
      initialStyles = counterpart.initialComputedStyle;
    } else {
      // This is the same Sprite moving elsewhere
      initialBounds = s.initialBounds.relativeToContext;
      initialStyles = s.initialComputedStyle;
    }

    assert('kept sprite should always have finalBounds', s.finalBounds);
    let finalBounds = s.finalBounds.relativeToContext;
    //let deltaX = finalBounds.left - initialBounds.left;
    //let deltaY = finalBounds.top - initialBounds.top;
    let velocity = initialVelocity;

    // TODO: these are probably not correct in every case
    //if (!(approximatelyEqual(deltaX, 0) && approximatelyEqual(deltaY, 0))) {
    s.setupAnimation('position', {
      duration,
      velocity,
      behavior,
      delay,
    });
    //}

    // TODO: we probably do not want to animate extremely tiny difference (i.e. decimals in the measurements)
    if (
      !approximatelyEqual(initialBounds?.width, finalBounds.width) ||
      !approximatelyEqual(initialBounds?.height, finalBounds.height)
    ) {
      s.setupAnimation('size', {
        duration,
        velocity,
        behavior,
        delay,
      });
    }

    // TODO: we don't support this yet
    /*s.setupAnimation('style', {
        property: 'backgroundColor',
        from: initialStyles['backgroundColor'],
      });*/
  }
}

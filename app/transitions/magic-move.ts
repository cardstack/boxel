import Changeset, { SpritesForArgs } from '../models/changeset';
import { assert } from '@ember/debug';
import SpringBehavior from 'animations/behaviors/spring';
import LinearBehavior from 'animations/behaviors/linear';
import { SpriteType } from 'animations/models/sprite';
import approximatelyEqual from 'animations/utils/approximately-equal';

const SPEED_PX_PER_MS = 0.25;

/**
  Moves, scales and transforms kept sprites.

  @function magicMove
  @export default
*/
export default function (changeset: Changeset, opts?: SpritesForArgs): void {
  let { keptSprites } = changeset;

  if (opts) {
    keptSprites = changeset.spritesFor({ ...opts, type: SpriteType.Kept });
  }

  for (let s of keptSprites) {
    assert(
      'kept sprite should always have initialBounds & finalBounds',
      s.initialBounds && s.finalBounds
    );
    let initialBounds = s.initialBounds.relativeToContext;
    let initialStyles = s.initialComputedStyle;
    let initialVelocity;
    let time;

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
    let deltaX = finalBounds.left - initialBounds.left;
    let deltaY = finalBounds.top - initialBounds.top;
    let duration = (deltaX ** 2 + deltaY ** 2) ** 0.5 / SPEED_PX_PER_MS;
    let velocity = initialVelocity;

    if (!(approximatelyEqual(deltaX, 0) && approximatelyEqual(deltaY, 0))) {
      s.setupAnimation('position', {
        startX: -deltaX,
        startY: -deltaY,
        duration,
        velocity,
        behavior: new LinearBehavior(), //new SpringBehavior({ overshootClamping: true, damping: 100 }),
      });
    }

    // TODO: we probably do not want to animate extremely tiny difference (i.e. decimals in the measurements)
    if (
      !approximatelyEqual(initialBounds?.width, finalBounds.width) ||
      !approximatelyEqual(initialBounds?.height, finalBounds.height)
    ) {
      s.setupAnimation('size', {
        startWidth: initialBounds?.width,
        startHeight: initialBounds?.height,
        duration,
        velocity,
        behavior: new LinearBehavior(), //new SpringBehavior({ overshootClamping: true, damping: 100 }),
      });
    }

    // TODO: we don't support this yet
    /*s.setupAnimation('style', {
        property: 'backgroundColor',
        from: initialStyles['backgroundColor'],
      });*/
  }
}

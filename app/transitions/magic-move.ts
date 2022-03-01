import Changeset, { SpritesForArgs } from '../models/changeset';
import { SpriteAnimation } from '../models/sprite-animation';
import { assert } from '@ember/debug';
import SpringBehavior from 'animations/behaviors/spring';
import LinearBehavior from 'animations/behaviors/linear';
import { SpriteType } from 'animations/models/sprite';

const SPEED_PX_PER_MS = 0.05;

/**
  Moves, scales and transforms kept sprites.

  @function magicMove
  @export default
*/
export default async function (
  changeset: Changeset,
  opts?: SpritesForArgs
): Promise<void> {
  let keptSprites = changeset.keptSprites;

  if (opts) {
    keptSprites = changeset.spritesFor({ ...opts, type: SpriteType.Kept });
  }

  let animations: SpriteAnimation[] = [];

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

      counterpart.element.getAnimations().forEach((a) => a.pause());
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

    s.setupAnimation('position', {
      startX: -deltaX,
      startY: -deltaY,
      duration: 5000,
      velocity,
      behavior: new LinearBehavior(), //new SpringBehavior({ overshootClamping: true, damping: 100 }),
    });

    s.setupAnimation('size', {
      startWidth: initialBounds?.width ?? undefined,
      startHeight: initialBounds?.height ?? undefined,
      duration,
      velocity,
      behavior: new SpringBehavior({ overshootClamping: true, damping: 100 }),
    });

    // TODO: we don't support this yet
    /*s.setupAnimation('style', {
        property: 'backgroundColor',
        from: initialStyles['backgroundColor'],
      });*/

    animations.push(s.startAnimation({ time: time ?? undefined }));
  }
  await Promise.all(animations.map((a) => a.finished));
}

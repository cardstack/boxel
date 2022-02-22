import Changeset from '../models/changeset';
import { SpriteAnimation } from '../models/sprite-animation';
import { assert } from '@ember/debug';
import SpringBehavior from 'animations/behaviors/spring';

const SPEED_PX_PER_MS = 0.05;

/**
  Moves, scales and transforms (inserted, removed, and) kept sprites.

  @function magicMove
  @export default
*/
export default async function (changeset: Changeset): Promise<void> {
  let { context, removedSprites, insertedSprites, keptSprites } = changeset;

  /*let allSprites = [...removedSprites, ...insertedSprites, ...keptSprites];
  allSprites.forEach((sprite) => {
    let activeAnimations = sprite.element.getAnimations();
    sprite.activeAnimations.
  })*/

  let animations: SpriteAnimation[] = [];
  /*for (let s of [...removedSprites]) {
    context.appendOrphan(s);
    s.lockStyles();
    s.setupAnimation('opacity', { to: 0 });
    animations.push(s.startAnimation());
  }*/

  // TODO: if we get keptSprites of some things
  // were fading out and then we should get interrupted and decide to
  // keep them around after all.
  for (let s of [/*...insertedSprites, ...removedSprites,*/ ...keptSprites]) {
    let initialBounds;
    let initialVelocity;
    let time;

    assert(
      'kept sprite should always have initialBounds & finalBounds',
      s.initialBounds
    );
    initialBounds = s.initialBounds.relativeToContext;

    if (s.type === 'kept') {
      if (s.counterpart) {
        let counterpart = s.counterpart;

        counterpart.hide();
        context.appendOrphan(s.counterpart);
        counterpart.lockStyles();
        counterpart.element.style.zIndex = '1';
        assert(
          'sent sprite should always have initialBounds & finalBounds',
          counterpart.initialBounds
        );
        initialBounds = counterpart.initialBounds.relativeToContext;
      }

      //console.log('initial bounds', initialBounds);

      assert('kept sprite should always have finalBounds', s.finalBounds);
      let finalBounds = s.finalBounds.relativeToContext;
      let deltaX = finalBounds.left - initialBounds.left;
      let deltaY = finalBounds.top - initialBounds.top;
      let duration = (deltaX ** 2 + deltaY ** 2) ** 0.5 / SPEED_PX_PER_MS;
      let velocity = initialVelocity;

      //console.log('delta', deltaX, deltaY);

      s.setupAnimation('position', {
        startX: -deltaX,
        startY: -deltaY,
        duration,
        velocity,
        behavior: new SpringBehavior({ overshootClamping: true, damping: 100 }),
      });

      //console.log(initialBounds?.width, initialBounds?.height);

      s.setupAnimation('size', {
        startWidth: initialBounds?.width ?? undefined,
        startHeight: initialBounds?.height ?? undefined,
        duration,
        velocity,
        behavior: new SpringBehavior({ overshootClamping: true, damping: 100 }),
      });

      animations.push(s.startAnimation({ time: time ?? undefined }));
    }
  }
  await Promise.all(animations.map((a) => a.finished));
}

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
    let activeAnimations = s.element.getAnimations(); // TODO: this is not supported in Safari
    console.log(
      'ACTIVE CTP ANIMATIONS',
      s.counterpart?.element.getAnimations().length
    );
    let initialBounds;
    let initialVelocity;
    let time;

    // TODO: why do removedSprites not have active animations here?
    console.log('Active animations: ', activeAnimations.length);
    if (activeAnimations.length) {
      let activeAnimation = activeAnimations[0];
      activeAnimation.pause();
      s.lockStyles(s.initialBounds?.relativeToContext);
      time = activeAnimation.currentTime;
      // TODO: extract actual precalculated velocity instead of guesstimating
      let bounds = s.captureAnimatingBounds(context.element);
      initialBounds = bounds.relativeToContext;
      initialVelocity = bounds.velocity;
      s.unlockStyles();
      activeAnimation.cancel();
    } else {
      assert(
        'kept sprite should always have initialBounds & finalBounds',
        s.initialBounds
      );
      initialBounds = s.initialBounds.relativeToContext;
    }

    if (s.type === 'kept') {
      console.log(
        'COUNTERPART',
        s.counterpart,
        s.counterpart?.initialBounds,
        s.counterpart?.finalBounds,
        s.counterpart?.element.getAnimations().length
      );
      if (s.counterpart) {
        let counterpart = s.counterpart;

        //s.hide();
        context.appendOrphan(s.counterpart);
        counterpart.lockStyles();
        counterpart.element.style.zIndex = '1';
        console.log(
          'COUNTERPART appended',
          s.counterpart,
          s.counterpart?.initialBounds,
          s.counterpart?.finalBounds,
          counterpart.element.getAnimations().length
        );

        let activeAnimations = counterpart.element.getAnimations();
        if (activeAnimations.length) {
          let activeAnimation = activeAnimations[0];
          activeAnimation.pause();
          counterpart.lockStyles(counterpart.initialBounds?.relativeToContext);
          time = activeAnimation.currentTime;
          // TODO: extract actual precalculated velocity instead of guesstimating
          let bounds = counterpart.captureAnimatingBounds(context.element);
          initialBounds = bounds.relativeToContext;
          initialVelocity = bounds.velocity;
          counterpart.unlockStyles();
          activeAnimation.cancel();
        } else {
          assert(
            'sent sprite should always have initialBounds & finalBounds',
            counterpart.initialBounds
          );
          initialBounds = counterpart.initialBounds.relativeToContext;
        }
        console.log('counterpart initial bounds ', initialBounds);
      }

      assert('kept sprite should always have finalBounds', s.finalBounds);
      let finalBounds = s.finalBounds.relativeToContext;
      let deltaX = finalBounds.left - initialBounds.left;
      let deltaY = finalBounds.top - initialBounds.top;
      let duration = (deltaX ** 2 + deltaY ** 2) ** 0.5 / SPEED_PX_PER_MS;
      let velocity = initialVelocity;

      console.log('delta', deltaX, deltaY);

      s.setupAnimation('position', {
        startX: -deltaX,
        startY: -deltaY,
        duration,
        velocity,
        behavior: new SpringBehavior({ overshootClamping: true, damping: 100 }),
      });

      console.log(initialBounds?.width, initialBounds?.height);

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

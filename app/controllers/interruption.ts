import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import Changeset from '../models/changeset';
import { assert } from '@ember/debug';
import SpringBehavior from 'animations/behaviors/spring';

const BALL_SPEED_PX_PER_MS = 0.05;
class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';
  animationOriginPosition: DOMRect | null = null;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @action moveBall(spriteId: string, changeset: Changeset) {
    let ballSprite = changeset.spriteFor({ id: spriteId });
    assert('ballSprite is present', ballSprite);
    let activeAnimations = ballSprite.element.getAnimations(); // TODO: this is not supported in Safari
    let initialBounds;
    let initialVelocity;
    let time;
    if (activeAnimations.length) {
      let activeAnimation = activeAnimations[0];
      activeAnimation.pause();
      ballSprite.lockStyles(this.animationOriginPosition);
      time = activeAnimation.currentTime;
      // TODO: extract actual precalculated velocity instead of guesstimating
      let bounds = ballSprite.captureAnimatingBounds(changeset.context.element);
      initialBounds = bounds.relativeToContext;
      initialVelocity = bounds.velocity;
      ballSprite.unlockStyles();
      activeAnimation.cancel();
    } else {
      assert(
        'kept sprite should always have initialBounds & finalBounds',
        ballSprite.initialBounds
      );
      initialBounds = ballSprite.initialBounds.relativeToContext;
    }
    assert(
      'kept sprite should always have finalBounds',
      ballSprite.finalBounds
    );
    let finalBounds = ballSprite.finalBounds.relativeToContext;
    this.animationOriginPosition = finalBounds;
    let deltaX = finalBounds.left - initialBounds.left;
    let deltaY = finalBounds.top - initialBounds.top;
    let duration = (deltaX ** 2 + deltaY ** 2) ** 0.5 / BALL_SPEED_PX_PER_MS;
    let velocity = initialVelocity;
    ballSprite.setupAnimation('position', {
      startX: -deltaX,
      startY: -deltaY,
      duration,
      velocity,
      behavior: new SpringBehavior({ overshootClamping: true, damping: 100 }),
    });
    return (
      ballSprite
        .startAnimation({ time: time ?? undefined })
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .finished.catch(() => {})
    ); // promise rejects when animation is prematurely canceled
  }
}

export default InterruptionController;

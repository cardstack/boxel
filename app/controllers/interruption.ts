import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import Changeset from '../models/changeset';
import { assert } from '@ember/debug';

const BALL_SPEED_PX_PER_MS = 0.05;
class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';
  animationOriginPosition: DOMRect | null = null;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  @action moveBall(changeset: Changeset) {
    let ballSprite = changeset.spriteFor({ id: 'ball' });
    assert('ballSprite is present', ballSprite);
    let activeAnimations = ballSprite.element.getAnimations(); // TODO: this is not supported in Safari
    let initialBounds;
    if (activeAnimations.length) {
      let activeAnimation = activeAnimations[0];
      activeAnimation.pause();
      ballSprite.lockStyles(this.animationOriginPosition);
      initialBounds = ballSprite.captureAnimatingBounds(
        changeset.context.element
      ).relativeToContext;
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
    let deltaX = initialBounds.left - finalBounds.left;
    let deltaY = initialBounds.top - finalBounds.top;
    let duration = (deltaX ** 2 + deltaY ** 2) ** 0.5 / BALL_SPEED_PX_PER_MS;
    let animation = ballSprite.element.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' },
      ],
      {
        duration,
      }
    );
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return animation.finished.catch(() => {}); // promise rejects when animation is prematurely canceled
  }
}

export default InterruptionController;

import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { measure } from '../utils/measurement';

const BALL_SPEED_PX_PER_MS = 0.05;
class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';

  @action moveBall({ context, keptSprites }) {
    let ballSprite = Array.from(keptSprites)[0];
    let activeAnimations = ballSprite.element.getAnimations(); // TODO: this is not supported in Safari
    let initialBounds;
    if (activeAnimations.length) {
      let activeAnimation = activeAnimations[0];
      activeAnimation.pause();
      ballSprite.lockStyles(this.animationOriginPosition);
      initialBounds = measure({
        contextElement: context.element,
        element: ballSprite.element,
        withAnimations: true,
      }).relativeToContext;
      ballSprite.unlockStyles();
      activeAnimation.cancel();
    } else {
      initialBounds = ballSprite.initialBounds.relativeToContext;
    }
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
    return animation.finished.catch(() => {});
  }
}

export default InterruptionController;

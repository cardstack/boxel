import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

const BALL_SPEED_PX_PER_MS = 0.1;
class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';

  @action moveBall({ keptSprites }) {
    let ballSprite = Array.from(keptSprites)[0];
    let activeAnimations = ballSprite.element.getAnimations(); // TODO: this is not supported in Safari
    let initialBounds;
    if (activeAnimations.length) {
      let activeAnimation = activeAnimations[0];
      activeAnimation.pause();
      ballSprite.lockStyles(this.animationOriginPosition);
      initialBounds = ballSprite.element.getBoundingClientRect();
      ballSprite.unlockStyles();
      activeAnimation.cancel();
    } else {
      initialBounds = ballSprite.initialBounds.relativeToContext;
    }
    let finalBounds = ballSprite.finalBounds.relativeToContext;
    this.animationOriginPosition = finalBounds;
    console.log({ initialBounds, finalBounds });
    let deltaX = initialBounds.left - finalBounds.left;
    let deltaY = initialBounds.top - finalBounds.top;
    let duration = (deltaX ** 2 + deltaY ** 2) ** 0.5 / BALL_SPEED_PX_PER_MS;
    console.log({ duration });
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

  moveBallNew = {
    transition({ animate, keptSprites }) {
      let ballSprite = keptSprites.values().next().value;
      // let activeAnimations = ballSprite.element.getAnimations(); // TODO: this is not supported in Safari
      // let initialBounds;
      // if (activeAnimations.length) {
      //   let activeAnimation = activeAnimations[0];
      //   activeAnimation.pause();
      //   ballSprite.lockStyles(this.animationOriginPosition);
      //   initialBounds = ballSprite.element.getBoundingClientRect();
      //   ballSprite.unlockStyles();
      //   activeAnimation.cancel();
      // } else {
      //
      let initialBounds = ballSprite.initialBounds.relativeToContext;
      let finalBounds = ballSprite.finalBounds.relativeToContext;
      console.table({ initialBounds, finalBounds });
      let deltaX = initialBounds.left - finalBounds.left;
      let deltaY = initialBounds.top - finalBounds.top;
      let duration = (deltaX ** 2 + deltaY ** 2) ** 0.5 / BALL_SPEED_PX_PER_MS;

      console.table([
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' },
      ]);
      animate(
        ballSprite,
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration,
          easing: 'ease-in-out',
        }
      );
    },
  };
}

export default InterruptionController;

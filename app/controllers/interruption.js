import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

class InterruptionController extends Controller {
  @tracked ballGoWhere = 'A';

  @action moveBall({ keptSprites }) {
    let ballSprite = Array.from(keptSprites)[0];
    let activeAnimations = ballSprite.element.getAnimations(); // TODO: this is not supported in Safari
    if (activeAnimations.length) {
      let activeAnimation = activeAnimations[0];
      activeAnimation.cancel();
      debugger;
    }
    let initialBounds = ballSprite.initialBounds.relativeToContext;
    let finalBounds = ballSprite.finalBounds.relativeToContext;
    let deltaX = initialBounds.left - finalBounds.left;
    let deltaY = initialBounds.top - finalBounds.top;
    let animation = ballSprite.element.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: 'translate(0, 0)' },
      ],
      {
        duration: 5000,
      }
    );
    return animation.finished.catch(() => {});
  }
}

export default InterruptionController;

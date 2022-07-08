import Controller from '@ember/controller';
import Changeset from 'animations-experiment/models/changeset';
import runAnimations from 'animations-experiment/utils/run-animations';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import LinearBehavior from 'animations-experiment/behaviors/linear';

export default class DoubleRenderController extends Controller {
  @tracked count = 0;
  @tracked isShowing = true;

  @action
  hide() {
    this.isShowing = false;
  }

  @action
  show() {
    this.isShowing = true;
  }

  @action
  increment() {
    this.count += 1;
  }

  async transition(changeset: Changeset): Promise<void> {
    let { removedSprites, keptSprites, insertedSprites } = changeset;
    let duration = 3000;

    removedSprites.forEach((sprite) => {
      if (changeset.context.hasOrphan(sprite)) {
        changeset.context.removeOrphan(sprite);
      }
      console.log('handling removed sprite');
      changeset.context.appendOrphan(sprite);
      sprite.lockStyles();
      sprite.setupAnimation('position', {
        startY: 0,
        startX: 0,
        endY: -200,
        endX: 0,
        behavior: new LinearBehavior(),
        duration,
      });
    });

    insertedSprites.forEach((sprite) => {
      if (changeset.context.hasOrphan(sprite)) {
        changeset.context.removeOrphan(sprite);
      }
      sprite.setupAnimation('position', {
        startY: -200,
        behavior: new LinearBehavior(),
        duration,
      });
    });

    keptSprites.forEach((sprite) => {
      if (changeset.context.hasOrphan(sprite)) {
        changeset.context.removeOrphan(sprite);
      }
      sprite.setupAnimation('position', {
        startY: sprite.initialBounds?.relativeToContext.y,
        endY: sprite.finalBounds?.relativeToContext.y,
        behavior: new LinearBehavior(),
        duration,
      });
    });

    await runAnimations([
      ...removedSprites,
      ...keptSprites,
      ...insertedSprites,
    ]);

    console.log('done animating');
  }
}

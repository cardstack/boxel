import { Changeset } from 'animations-experiment/models/changeset';
import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import AnimationsService from 'animations-experiment/services/animations';
import { inject as service } from '@ember/service';

const FADE_DURATION = 1500;
const TRANSLATE_DURATION = 1500;
const MOVE_C_INTENT = 'move-c';
export default class BasicsController extends Controller {
  @service declare animations: AnimationsService;

  @tracked contextHasPadding = false;
  @tracked showContentBeforeContext = false;
  @tracked showContentBefore = false;
  @tracked showSpriteA = true;
  @tracked spriteAPositionBottom = false;
  @tracked showSpriteB = true;
  @tracked spriteCPosition = 0;
  @tracked showContentAfter = false;
  @action toggleSpritesAandB(): void {
    this.showSpriteA = !this.showSpriteA;
    this.showSpriteB = !this.showSpriteB;
  }
  @action moveSpriteC(): void {
    this.animations.setIntent(MOVE_C_INTENT);
    this.spriteCPosition = (this.spriteCPosition + 1) % 2;
  }
  async innerTransition(changeset: Changeset): Promise<void> {
    let { context, intent, insertedSprites, keptSprites, removedSprites } =
      changeset;
    if (intent === MOVE_C_INTENT) {
      return;
    }

    let animations = [];
    for (let removedSprite of [...removedSprites]) {
      context.appendOrphan(removedSprite);
      removedSprite.lockStyles();
      removedSprite.hide();
      removedSprite.setupAnimation('opacity', {
        to: 0,
        duration: FADE_DURATION,
      });
      animations.push(removedSprite.startAnimation());
    }

    for (let insertedSprite of [...insertedSprites]) {
      insertedSprite.setupAnimation('opacity', {
        delay: FADE_DURATION,
        duration: TRANSLATE_DURATION,
      });
      animations.push(insertedSprite.startAnimation());
    }

    for (let keptSprite of [...keptSprites]) {
      keptSprite.setupAnimation('position', {
        delay: removedSprites.size > 0 ? 1500 : 0,
        duration: TRANSLATE_DURATION,
      });
      if (keptSprite.role === 'container') {
        keptSprite.setupAnimation('size', {
          delay: removedSprites.size > 0 ? 1500 : 0,
          duration: TRANSLATE_DURATION,
        });
      }
      animations.push(keptSprite.startAnimation());
    }

    await Promise.all(animations.map((a) => a.finished));
  }

  async outerTransition(changeset: Changeset): Promise<void> {
    let { intent, keptSprites } = changeset;
    if (intent !== MOVE_C_INTENT) {
      return;
    }
    let animations = [];
    for (let keptSprite of [...keptSprites]) {
      keptSprite.setupAnimation('position', { duration: TRANSLATE_DURATION });
      animations.push(keptSprite.startAnimation());
    }

    await Promise.all(animations.map((a) => a.finished));
  }
}

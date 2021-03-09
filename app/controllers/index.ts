import { assert } from '@ember/debug';
import Changeset from '../models/changeset';
import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import AnimationsService from '../services/animations';
import { inject as service } from '@ember/service';

const FADE_DURATION = 1500;
const TRANSLATE_DURATION = 1500;
const MOVE_C_INTENT = 'move-c';
export default class IndexController extends Controller {
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
  async innerTransition({
    context,
    intent,
    insertedSprites,
    keptSprites,
    removedSprites,
  }: Changeset): Promise<void> {
    if (intent === MOVE_C_INTENT) {
      return;
    }
    assert('context has an orphansElement', context.orphansElement);

    let animations = [];
    for (let removedSprite of Array.from(removedSprites)) {
      context.orphansElement.appendChild(removedSprite.element);
      removedSprite.lockStyles();
      let animation = removedSprite.element.animate(
        [{ opacity: 1 }, { opacity: 0 }, { opacity: 0 }],
        {
          duration: FADE_DURATION + TRANSLATE_DURATION,
        }
      );
      animations.push(animation);
    }

    for (let insertedSprite of Array.from(insertedSprites)) {
      let animation = insertedSprite.element.animate(
        [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }],
        {
          duration: FADE_DURATION + TRANSLATE_DURATION,
        }
      );
      animations.push(animation);
    }

    for (let keptSprite of [...keptSprites]) {
      assert(
        'keptSprite always has an initialBounds and finalBounds',
        keptSprite.initialBounds && keptSprite.finalBounds
      );
      let initialBounds = keptSprite.initialBounds.relativeToContext;
      let finalBounds = keptSprite.finalBounds.relativeToContext;
      let deltaX = finalBounds.left - initialBounds.left;
      let deltaY = finalBounds.top - initialBounds.top;
      let translationKeyFrames: Keyframe[] = [
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
        },
        {
          transform: 'translate(0, 0)',
        },
      ];
      if (keptSprite.id === 'container') {
        translationKeyFrames = [
          {
            width: `${initialBounds.width}px`,
            height: `${initialBounds.height}px`,
          },
          {
            width: `${finalBounds.width}px`,
            height: `${finalBounds.height}px`,
          },
        ];
      }
      if (removedSprites.size > 0) {
        translationKeyFrames.unshift(translationKeyFrames[0]);
      }
      if (insertedSprites.size > 0) {
        translationKeyFrames.push(
          translationKeyFrames[translationKeyFrames.length - 1]
        );
      }
      console.log(keptSprite.id);
      console.table(translationKeyFrames);
      let animation = keptSprite.element.animate(translationKeyFrames, {
        duration: FADE_DURATION + TRANSLATE_DURATION,
      });
      animations.push(animation);
    }

    await Promise.all(animations.map((a) => a.finished)).then(() => {
      context.clearOrphans();
    });
  }

  async outerTransition({ intent, keptSprites }: Changeset): Promise<void> {
    if (intent !== MOVE_C_INTENT) {
      return;
    }
    let animations = [];
    for (let keptSprite of [...keptSprites]) {
      assert(
        'keptSprite always has an element, initialBounds and finalBounds',
        keptSprite.element && keptSprite.initialBounds && keptSprite.finalBounds
      );
      let initialBounds = keptSprite.initialBounds.relativeToContext;
      let finalBounds = keptSprite.finalBounds.relativeToContext;

      let deltaX = initialBounds.left - finalBounds.left;
      let deltaY = initialBounds.top - finalBounds.top;

      let translationKeyFrames = [
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
        },
        {
          transform: 'translate(0, 0)',
        },
      ];
      let animation = keptSprite.element.animate(translationKeyFrames, {
        duration: TRANSLATE_DURATION,
      });
      animations.push(animation);
    }

    await Promise.all(animations.map((a) => a.finished));
  }
}

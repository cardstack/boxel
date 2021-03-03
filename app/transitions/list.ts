import { assert } from '@ember/debug';
import Changeset from '../models/changeset';

// FADE OUT : ----------
// TRANSLATE:     ----------
// FADE IN  :          ----------

// const FADE_OUT_START = 0;
const FADE_OUT_DURATION = 1000;
const TRANSLATE_DURATION = 1000;
const TRANSLATE_START = 400;
const FADE_IN_DURATION = 1000;
const FADE_IN_START = 900;
const TOTAL_DURATION = FADE_IN_START + FADE_IN_DURATION;

export default function listTransition({
  context,
  insertedSprites,
  receivedSprites,
  removedSprites,
}: Changeset): Promise<void> {
  assert('context has an orphansElement', context.orphansElement);
  let animations = [];
  for (let receivedSprite of Array.from(receivedSprites)) {
    assert('receivedSprite is not null', !!receivedSprite);
    assert(
      'receivedSprites always have intialBounds',
      !!receivedSprite.initialBounds
    );
    assert(
      'receivedSprites always have finalBounds',
      !!receivedSprite.finalBounds
    );
    assert(
      'receivedSprites always have a counterpart',
      !!receivedSprite.counterpart
    );
    let initialBounds = receivedSprite.initialBounds.relativeToContext;
    let finalBounds = receivedSprite.finalBounds.relativeToContext;
    let deltaX = initialBounds.left - finalBounds.left;
    let deltaY = initialBounds.top - finalBounds.top;

    let clonedNode = receivedSprite.counterpart.element.cloneNode(true);
    let clone: HTMLElement = clonedNode as HTMLElement;
    receivedSprite.counterpart.element.style.opacity = '0';

    context.orphansElement.appendChild(clone);
    clone.style.position = 'absolute';
    let cloneBounds = receivedSprite.finalBounds.relativeToPosition(
      receivedSprite.finalBounds.parent
    );
    clone.style.left = cloneBounds.left + 'px';
    clone.style.top = cloneBounds.top + 'px';

    let initialFontSize = getComputedStyle(clone).fontSize;
    let finalFontSize = getComputedStyle(receivedSprite.element).fontSize;
    receivedSprite.element.style.opacity = '0';
    let translationKeyFrames = [
      {
        transform: `translate(${deltaX}px, ${deltaY}px)`,
        fontSize: initialFontSize,
      },
      {
        transform: `translate(${deltaX}px, ${deltaY}px)`,
        fontSize: initialFontSize,
        offset: TRANSLATE_START / TOTAL_DURATION,
      },
      {
        transform: 'translate(0, 0)',
        fontSize: finalFontSize,
        offset: (TRANSLATE_START + TRANSLATE_DURATION) / TOTAL_DURATION,
      },
      { transform: 'translate(0, 0)', fontSize: finalFontSize },
    ];

    let animation = clone.animate(translationKeyFrames, {
      duration: TOTAL_DURATION,
    });
    animations.push(animation);
  }

  for (let removedSprite of Array.from(removedSprites)) {
    removedSprite.lockStyles();
    context.orphansElement.appendChild(removedSprite.element);
    let animation = removedSprite.element.animate(
      [
        { opacity: 1 },
        { opacity: 0, offset: FADE_OUT_DURATION / TOTAL_DURATION },
        { opacity: 0 },
      ],
      {
        duration: TOTAL_DURATION,
      }
    );
    animations.push(animation);
  }

  for (let insertedSprite of Array.from(insertedSprites)) {
    let animation = insertedSprite.element.animate(
      [
        { opacity: 0 },
        { opacity: 0, offset: FADE_IN_START / TOTAL_DURATION },
        { opacity: 1 },
      ],
      {
        duration: TOTAL_DURATION,
      }
    );
    animations.push(animation);
  }

  return Promise.all(animations.map((a) => a.finished)).then(() => {
    context.clearOrphans();
    for (let receivedSprite of Array.from(receivedSprites)) {
      receivedSprite.element.style.removeProperty('opacity');
    }
  });
}

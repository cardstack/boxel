const FADE_DURATION = 3000;
const TRANSLATE_DURATION = 3000;

function positionAbsolute(sprite) {
  let bounds = sprite.initialBounds.relativeToContext;
  sprite.element.style.position = 'absolute';
  sprite.element.style.left = bounds.left + 'px';
  sprite.element.style.top = bounds.top + 'px';
}

export default function exampleTransition(
  { insertedSprites, keptSprites, removedSprites },
  orphansElement
) {
  let animations = [];
  for (let removedSprite of Array.from(removedSprites)) {
    orphansElement.appendChild(removedSprite.element);
    positionAbsolute(removedSprite);
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

  for (let keptSprite of Array.from(keptSprites)) {
    let initialBounds = keptSprite.initialBounds.relativeToContext;
    let finalBounds = keptSprite.finalBounds.relativeToContext;
    let deltaY = initialBounds.top - finalBounds.top;
    let translationKeyFrames = [
      { transform: `translate(0, ${deltaY}px)` },
      { transform: 'translate(0, 0)' },
    ];
    if (removedSprites.size > 0) {
      translationKeyFrames.unshift(translationKeyFrames[0]);
    }
    if (insertedSprites.size > 0) {
      translationKeyFrames.push(
        translationKeyFrames[translationKeyFrames.length - 1]
      );
    }

    let animation = keptSprite.element.animate(translationKeyFrames, {
      duration: FADE_DURATION + TRANSLATE_DURATION,
    });
    animations.push(animation);
  }

  return Promise.all(animations.map((a) => a.finished)).then(() => {
    for (let removedSprite of Array.from(removedSprites)) {
      orphansElement.removeChild(removedSprite.element);
    }
  });
}

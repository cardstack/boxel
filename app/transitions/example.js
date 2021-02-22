const FADE_DURATION = 3000;
const TRANSLATE_DURATION = 3000;

function positionAbsolute(sprite) {
  sprite.element.style.position = 'absolute';
  sprite.element.style.left = sprite.initialBounds.left + 'px';
  sprite.element.style.top = sprite.initialBounds.top + 'px';
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
    let deltaY = keptSprite.initialBounds.top - keptSprite.finalBounds.top;
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

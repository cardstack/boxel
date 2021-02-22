const FADE_DURATION = 3000;
const TRANSLATE_DURATION = 3000;

export default function exampleTransition(
  { insertedSprites, keptSprites, removedSprites },
  orphansElement
) {
  console.log(...arguments);
  let animations = [];
  for (let removedSprite of Array.from(removedSprites)) {
    console.log('fade out ', removedSprite);
    orphansElement.appendChild(removedSprite.element);
    removedSprite.element.style.position = 'absolute';
    let animation = removedSprite.element.animate(
      [{ opacity: 1 }, { opacity: 0 }, { opacity: 0 }],
      {
        duration: FADE_DURATION + TRANSLATE_DURATION,
      }
    );
    animations.push(animation);
  }

  for (let insertedSprite of Array.from(insertedSprites)) {
    console.log('fade in ', insertedSprite);
    // insertedSprite.element.style.position = 'absolute';
    let animation = insertedSprite.element.animate(
      [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }],
      {
        duration: FADE_DURATION + TRANSLATE_DURATION,
      }
    );
    animations.push(animation);
  }

  for (let keptSprite of Array.from(keptSprites)) {
    console.log('translate ', keptSprite);
    let deltaY = keptSprite.initialBounds.top - keptSprite.finalBounds.top;
    console.log({ deltaY });
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

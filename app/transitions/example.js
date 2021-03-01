const FADE_DURATION = 1500;
const TRANSLATE_DURATION = 1500;

export default function exampleTransition({
  context,
  insertedSprites,
  keptSprites,
  receivedSprites,
  removedSprites,
}) {
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

  for (let keptSprite of Array.from(keptSprites)) {
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

    let animation = keptSprite.element.animate(translationKeyFrames, {
      duration: FADE_DURATION + TRANSLATE_DURATION,
    });
    animations.push(animation);
  }

  for (let receivedSprite of Array.from(receivedSprites)) {
    let initialBounds = receivedSprite.initialBounds.relativeToPosition(
      receivedSprite.finalBounds.parent
    );
    let finalBounds = receivedSprite.finalBounds.relativeToPosition(
      receivedSprite.finalBounds.parent
    );
    receivedSprite.element.style.opacity = 0;

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
    context.orphansElement.appendChild(receivedSprite.counterpart.element);
    receivedSprite.counterpart.lockStyles(
      receivedSprite.finalBounds.relativeToPosition(
        receivedSprite.finalBounds.parent
      )
    );
    let animation = receivedSprite.counterpart.element.animate(
      translationKeyFrames,
      {
        duration: TRANSLATE_DURATION,
      }
    );
    animations.push(animation);
  }

  return Promise.all(animations.map((a) => a.finished)).then(() => {
    for (let receivedSprite of Array.from(receivedSprites)) {
      receivedSprite.element.style.opacity = 1;
    }
    context.clearOrphans();
  });
}

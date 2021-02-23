const DURATION = 3000;

export default function listTransition(
  { insertedSprites, receivedSprites, removedSprites },
  orphansElement
) {
  if (receivedSprites.size === 0) {
    return; // this transition runs only when we are transitioning to the list from the detail view
  }
  let animations = [];
  for (let receivedSprite of Array.from(receivedSprites)) {
    receivedSprite.element.style.display = 'inline-block';
    let initialBounds = receivedSprite.initialBounds.relativeToContext;
    let finalBounds = receivedSprite.finalBounds.relativeToContext;
    let deltaX = initialBounds.left - finalBounds.left;
    let deltaY = initialBounds.top - finalBounds.top;

    orphansElement.appendChild(receivedSprite.counterpart.element);
    let initialFontSize = getComputedStyle(receivedSprite.counterpart.element)
      .fontSize;
    orphansElement.removeChild(receivedSprite.counterpart.element);
    let finalFontSize = getComputedStyle(receivedSprite.element).fontSize;

    let translationKeyFrames = [
      {
        transform: `translate(${deltaX}px, ${deltaY}px)`,
        fontSize: initialFontSize,
      },
      { transform: 'translate(0, 0)', fontSize: finalFontSize },
    ];

    let animation = receivedSprite.element.animate(translationKeyFrames, {
      duration: DURATION,
    });
    animations.push(animation);
  }

  for (let removedSprite of Array.from(removedSprites)) {
    removedSprite.lockStyles();
    orphansElement.appendChild(removedSprite.element);
    let animation = removedSprite.element.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: DURATION,
      }
    );
    animations.push(animation);
  }

  for (let insertedSprite of Array.from(insertedSprites)) {
    let animation = insertedSprite.element.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: DURATION,
      }
    );
    animations.push(animation);
  }

  return Promise.all(animations.map((a) => a.finished)).then(() => {
    while (orphansElement.firstChild) {
      orphansElement.removeChild(orphansElement.firstChild);
    }
  });
}

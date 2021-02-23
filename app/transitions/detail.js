const TRANSLATE_DURATION = 3000;

export default function detailTransition({ receivedSprites }, orphansElement) {
  if (receivedSprites.size === 0) {
    return; // this transition runs only when we are transitioning to the list from the detail view
  }
  let animations = [];
  for (let receivedSprite of Array.from(receivedSprites)) {
    let initialBounds = receivedSprite.initialBounds.relativeToPosition(
      receivedSprite.finalBounds.parent
    );
    let finalBounds = receivedSprite.finalBounds.relativeToPosition(
      receivedSprite.finalBounds.parent
    );
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
      duration: TRANSLATE_DURATION,
    });
    animations.push(animation);
  }

  return Promise.all(animations.map((a) => a.finished));
}

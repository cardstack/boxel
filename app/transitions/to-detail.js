const TRANSLATE_DURATION = 3000;

export default function toDetailTransition({ receivedSprites }) {
  let animations = [];
  for (let receivedSprite of Array.from(receivedSprites)) {
    let initialBounds = receivedSprite.initialBounds.relativeToContext;
    let finalBounds = receivedSprite.finalBounds.relativeToContext;
    let deltaX = initialBounds.top - finalBounds.top;
    let deltaY = initialBounds.top - finalBounds.top;
    let translationKeyFrames = [
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: 'translate(0, 0)' },
    ];

    let animation = receivedSprite.element.animate(translationKeyFrames, {
      duration: TRANSLATE_DURATION,
    });
    animations.push(animation);
  }

  return Promise.all(animations.map((a) => a.finished));
}

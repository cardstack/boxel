import Sprite, { INSERTED, KEPT, RECEIVED, REMOVED, SENT } from './sprite';

export default {
  createInsertedSprite(spriteModifier) {
    let sprite = new Sprite(
      spriteModifier.element,
      spriteModifier.id,
      INSERTED
    );
    sprite.finalBounds = spriteModifier.currentPosition.relativeToContext;
    return sprite;
  },
  createReceivedSprite(spriteModifier, farMatchedSpriteModifier) {
    let sprite = new Sprite(
      spriteModifier.element,
      spriteModifier.id,
      RECEIVED
    );
    farMatchedSpriteModifier.farMatch = spriteModifier;
    sprite.initialBounds =
      farMatchedSpriteModifier.currentPosition.relativeToContext;
    sprite.finalBounds = spriteModifier.currentPosition.relativeToContext;
    return sprite;
  },
  createSentSprite(spriteModifier) {
    let sprite = new Sprite(spriteModifier.element, spriteModifier.id, SENT);
    sprite.initialBounds = spriteModifier.currentPosition.relativeToContext;
    sprite.finalBounds =
      spriteModifier.farMatch.currentPosition.relativeToContext;
    return sprite;
  },
  createRemovedSprite(spriteModifier) {
    let sprite = new Sprite(spriteModifier.element, spriteModifier.id, REMOVED);
    sprite.initialBounds = spriteModifier.currentPosition.relativeToContext;
    return sprite;
  },
  createKeptSprite(spriteModifier) {
    let sprite = new Sprite(spriteModifier.element, spriteModifier.id, KEPT);
    sprite.initialBounds = spriteModifier.lastPosition.relativeToContext;
    sprite.finalBounds = spriteModifier.currentPosition.relativeToContext;
    return sprite;
  },
};

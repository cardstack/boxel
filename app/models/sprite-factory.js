import Sprite, { INSERTED, KEPT, RECEIVED, REMOVED, SENT } from './sprite';

export default {
  createInsertedSprite(spriteModifier) {
    let sprite = new Sprite(
      spriteModifier.element,
      spriteModifier.id,
      INSERTED
    );
    sprite.finalBounds = spriteModifier.currentBounds;
    return sprite;
  },
  createReceivedSprite(spriteModifier, farMatchedSpriteModifier) {
    let sprite = new Sprite(
      spriteModifier.element,
      spriteModifier.id,
      RECEIVED
    );
    farMatchedSpriteModifier.farMatch = spriteModifier;
    sprite.initialBounds = farMatchedSpriteModifier.currentBounds;
    sprite.finalBounds = spriteModifier.currentBounds;

    sprite.counterpart = new Sprite(
      farMatchedSpriteModifier.element,
      farMatchedSpriteModifier.id,
      SENT
    );
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = farMatchedSpriteModifier.currentBounds;
    sprite.counterpart.finalBounds = spriteModifier.currentBounds;

    return sprite;
  },
  createSentSprite(spriteModifier) {
    let sprite = new Sprite(spriteModifier.element, spriteModifier.id, SENT);
    sprite.initialBounds = spriteModifier.currentBounds;
    sprite.finalBounds = spriteModifier.farMatch.currentBounds;

    sprite.counterpart = new Sprite(
      spriteModifier.farMatch.element,
      spriteModifier.farMatch.id,
      RECEIVED
    );
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = spriteModifier.currentBounds;
    sprite.counterpart.finalBounds = spriteModifier.farMatch.currentBounds;

    return sprite;
  },
  createRemovedSprite(spriteModifier) {
    let sprite = new Sprite(spriteModifier.element, spriteModifier.id, REMOVED);
    sprite.initialBounds = spriteModifier.currentBounds;
    return sprite;
  },
  createKeptSprite(spriteModifier) {
    let sprite = new Sprite(spriteModifier.element, spriteModifier.id, KEPT);
    sprite.initialBounds = spriteModifier.lastBounds;
    sprite.finalBounds = spriteModifier.currentBounds;
    return sprite;
  },
};

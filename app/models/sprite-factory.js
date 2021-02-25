import Sprite, { INSERTED, KEPT, RECEIVED, REMOVED, SENT } from './sprite';

export default {
  createInsertedSprite(changeset, spriteModifier) {
    let sprite = new Sprite(changeset, spriteModifier, INSERTED);
    sprite.finalBounds = spriteModifier.currentBounds;
    return sprite;
  },
  createReceivedSprite(changeset, spriteModifier, farMatchedSpriteModifier) {
    let sprite = new Sprite(
      spriteModifier.element,
      spriteModifier.id,
      RECEIVED
    );
    farMatchedSpriteModifier.farMatch = spriteModifier;
    sprite.initialBounds = farMatchedSpriteModifier.currentBounds;
    sprite.finalBounds = spriteModifier.currentBounds;

    sprite.counterpart = new Sprite(changeset, farMatchedSpriteModifier, SENT);
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = farMatchedSpriteModifier.currentBounds;
    sprite.counterpart.finalBounds = spriteModifier.currentBounds;

    return sprite;
  },
  createSentSprite(changeset, spriteModifier) {
    let sprite = new Sprite(changeset, spriteModifier, SENT);
    sprite.initialBounds = spriteModifier.currentBounds;
    sprite.finalBounds = spriteModifier.farMatch.currentBounds;

    sprite.counterpart = new Sprite(
      changeset,
      spriteModifier.farMatch,
      RECEIVED
    );
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = spriteModifier.currentBounds;
    sprite.counterpart.finalBounds = spriteModifier.farMatch.currentBounds;

    return sprite;
  },
  createRemovedSprite(changeset, spriteModifier) {
    let sprite = new Sprite(changeset, spriteModifier, REMOVED);
    sprite.initialBounds = spriteModifier.currentBounds;
    return sprite;
  },
  createKeptSprite(changeset, spriteModifier) {
    let sprite = new Sprite(changeset, spriteModifier, KEPT);
    sprite.initialBounds = spriteModifier.lastBounds;
    sprite.finalBounds = spriteModifier.currentBounds;
    return sprite;
  },
};

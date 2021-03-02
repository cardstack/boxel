import Sprite, { SpriteType } from './sprite';
import SpriteModifier from '../modifiers/sprite';
import { assert } from '@ember/debug';

export default {
  createInsertedSprite(spriteModifier: SpriteModifier): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Inserted
    );
    sprite.finalBounds = spriteModifier.currentBounds;
    return sprite;
  },
  createReceivedSprite(
    spriteModifier: SpriteModifier,
    farMatchedSpriteModifier: SpriteModifier
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Received
    );
    farMatchedSpriteModifier.farMatch = spriteModifier;
    sprite.initialBounds = farMatchedSpriteModifier.currentBounds;
    sprite.finalBounds = spriteModifier.currentBounds;

    sprite.counterpart = new Sprite(
      farMatchedSpriteModifier.element as HTMLElement,
      farMatchedSpriteModifier.id as string | null,
      SpriteType.Sent
    );
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = farMatchedSpriteModifier.currentBounds;
    sprite.counterpart.finalBounds = spriteModifier.currentBounds;

    return sprite;
  },
  createSentSprite(spriteModifier: SpriteModifier): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Sent
    );
    sprite.initialBounds = spriteModifier.currentBounds;
    let farMatch = spriteModifier.farMatch;
    assert(
      'farMatch is set on a SpriteModifier passed to createSentSprite',
      farMatch
    );
    sprite.finalBounds = farMatch.currentBounds;

    sprite.counterpart = new Sprite(
      farMatch.element as HTMLElement,
      farMatch.id as string | null,
      SpriteType.Received
    );
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = spriteModifier.currentBounds;
    sprite.counterpart.finalBounds = farMatch.currentBounds;

    return sprite;
  },
  createRemovedSprite(spriteModifier: SpriteModifier): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Removed
    );
    sprite.initialBounds = spriteModifier.currentBounds;
    return sprite;
  },
  createKeptSprite(spriteModifier: SpriteModifier): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Kept
    );
    sprite.initialBounds = spriteModifier.lastBounds;
    sprite.finalBounds = spriteModifier.currentBounds;
    return sprite;
  },
};

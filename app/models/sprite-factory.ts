import Sprite, { SpriteType } from './sprite';
import SpriteModifier from '../modifiers/sprite';

import { assert } from '@ember/debug';
import ContextAwareBounds from './context-aware-bounds';
import AnimationContext from 'animations/components/animation-context';

export default {
  createInsertedSprite(
    spriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Inserted
    );
    assert(
      'inserted sprite should have currentBounds',
      spriteModifier.currentBounds && context.currentBounds
    );
    sprite.finalBounds = new ContextAwareBounds({
      element: spriteModifier.currentBounds,
      contextElement: context.currentBounds,
    });
    return sprite;
  },
  createReceivedSprite(
    spriteModifier: SpriteModifier,
    farMatchedSpriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Received
    );
    farMatchedSpriteModifier.farMatch = spriteModifier;
    assert(
      'far-matched sprite should have currentBounds',
      farMatchedSpriteModifier.currentBounds && context.lastBounds
    );
    sprite.initialBounds = new ContextAwareBounds({
      element: farMatchedSpriteModifier.currentBounds,
      contextElement: context.lastBounds,
    });
    assert(
      'received sprite should have currentBounds',
      spriteModifier.currentBounds && context.currentBounds
    );
    sprite.finalBounds = new ContextAwareBounds({
      element: spriteModifier.currentBounds,
      contextElement: context.currentBounds,
    });

    sprite.counterpart = new Sprite(
      farMatchedSpriteModifier.element as HTMLElement,
      farMatchedSpriteModifier.id as string | null,
      SpriteType.Sent
    );
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = new ContextAwareBounds({
      element: farMatchedSpriteModifier.currentBounds,
      contextElement: context.currentBounds,
    });
    sprite.counterpart.finalBounds = new ContextAwareBounds({
      element: spriteModifier.currentBounds,
      contextElement: context.currentBounds,
    });

    return sprite;
  },
  createSentSprite(
    spriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Sent
    );
    assert(
      'sent sprite should have currentBounds',
      spriteModifier.currentBounds && context.currentBounds
    );
    sprite.initialBounds = new ContextAwareBounds({
      element: spriteModifier.currentBounds,
      contextElement: context.currentBounds,
    });
    let farMatch = spriteModifier.farMatch;
    assert(
      'farMatch is set on a SpriteModifier passed to createSentSprite',
      farMatch && farMatch.currentBounds
    );
    sprite.finalBounds = new ContextAwareBounds({
      element: farMatch.currentBounds,
      contextElement: context.currentBounds,
    });

    sprite.counterpart = new Sprite(
      farMatch.element as HTMLElement,
      farMatch.id as string | null,
      SpriteType.Received
    );
    sprite.counterpart.counterpart = sprite;
    sprite.counterpart.initialBounds = new ContextAwareBounds({
      element: spriteModifier.currentBounds,
      contextElement: context.currentBounds,
    });
    sprite.counterpart.finalBounds = new ContextAwareBounds({
      element: farMatch.currentBounds,
      contextElement: context.currentBounds,
    });

    return sprite;
  },
  createRemovedSprite(
    spriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Removed
    );
    assert(
      'removed sprite should have currentBounds',
      spriteModifier.currentBounds && context.lastBounds
    );
    sprite.initialBounds = new ContextAwareBounds({
      element: spriteModifier.currentBounds,
      contextElement: context.lastBounds,
    });
    return sprite;
  },
  createKeptSprite(
    spriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      SpriteType.Kept
    );
    assert(
      'kept sprite should have lastBounds and currentBounds',
      spriteModifier.lastBounds &&
        context.lastBounds &&
        spriteModifier.currentBounds &&
        context.currentBounds
    );
    sprite.initialBounds = new ContextAwareBounds({
      element: spriteModifier.lastBounds,
      contextElement: context.lastBounds,
    });
    sprite.finalBounds = new ContextAwareBounds({
      element: spriteModifier.currentBounds,
      contextElement: context.currentBounds,
    });
    return sprite;
  },
};

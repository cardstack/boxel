import Sprite, { SpriteType } from './sprite';
import SpriteModifier from '../modifiers/sprite';

import { assert } from '@ember/debug';
import ContextAwareBounds from './context-aware-bounds';
import AnimationContext from 'animations-experiment/components/animation-context';

export default {
  createInsertedSprite(
    spriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      spriteModifier.role as string | null,
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
    sprite.finalComputedStyle = spriteModifier.currentComputedStyle;

    return sprite;
  },
  createRemovedSprite(
    spriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      spriteModifier.role as string | null,
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
    sprite.initialComputedStyle = spriteModifier.currentComputedStyle;
    return sprite;
  },
  createKeptSprite(
    spriteModifier: SpriteModifier,
    context: AnimationContext
  ): Sprite {
    let sprite = new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      spriteModifier.role as string | null,
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
    sprite.initialComputedStyle = spriteModifier.lastComputedStyle;
    sprite.finalComputedStyle = spriteModifier.currentComputedStyle;
    return sprite;
  },
  createIntermediateSprite(spriteModifier: SpriteModifier): Sprite {
    return new Sprite(
      spriteModifier.element as HTMLElement,
      spriteModifier.id as string | null,
      spriteModifier.role as string | null,
      SpriteType.Intermediate
    );
  },
};

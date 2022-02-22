import SpriteFactory from './sprite-factory';
import Sprite, { SpriteType } from './sprite';
import AnimationContext from '../components/animation-context';
import SpriteModifier from '../modifiers/sprite';
import { assert } from '@ember/debug';

type SpritesForArgs = {
  type?: SpriteType | undefined;
  role?: string | undefined;
  id?: string | undefined;
};

function union<T>(...sets: Set<T>[]): Set<T> {
  switch (sets.length) {
    case 0:
      return new Set();
    case 1:
      return new Set(sets[0]);
    default:
      // eslint-disable-next-line no-case-declarations
      let result = new Set<T>();
      for (let set of sets) {
        for (let item of set) {
          result.add(item);
        }
      }
      return result;
  }
}

export default class Changeset {
  context: AnimationContext;
  intent: string | undefined;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();

  constructor(animationContext: AnimationContext, intent: string | undefined) {
    this.context = animationContext;
    this.intent = intent;
  }

  spritesFor(criteria: SpritesForArgs): Set<Sprite> {
    assert(
      'expect spritesFor to be called with some criteria',
      criteria.type || criteria.role || criteria.id
    );
    let result;
    if (criteria.type) {
      switch (criteria.type) {
        case SpriteType.Inserted:
          result = new Set(this.insertedSprites);
          break;
        case SpriteType.Removed:
          result = new Set(this.removedSprites);
          break;
        case SpriteType.Kept:
          result = new Set(this.keptSprites);
          break;
      }
    }
    result =
      result ||
      union(this.keptSprites, this.insertedSprites, this.removedSprites);

    if (criteria.id) {
      for (let sprite of result) {
        if (sprite.id !== criteria.id) {
          result.delete(sprite);
        }
      }
    }
    if (criteria.role) {
      for (let sprite of result) {
        if (sprite.role !== criteria.role) {
          result.delete(sprite);
        }
      }
    }

    return result;
  }

  spriteFor(criteria: SpritesForArgs): Sprite | null {
    let set = this.spritesFor(criteria);
    if (set.size > 1) {
      throw new Error(
        `More than one sprite found matching criteria ${criteria}`
      );
    }
    if (set.size === 0) {
      return null;
    }
    return [...set][0];
  }

  addInsertedSprites(freshlyAdded: Set<SpriteModifier>): void {
    for (let spriteModifier of freshlyAdded) {
      this.insertedSprites.add(
        SpriteFactory.createInsertedSprite(spriteModifier, this.context)
      );
    }
  }

  addRemovedSprites(freshlyRemoved: Set<SpriteModifier>): void {
    for (let spriteModifier of freshlyRemoved) {
      this.removedSprites.add(
        SpriteFactory.createRemovedSprite(spriteModifier, this.context)
      );
    }
  }

  addKeptSprites(freshlyChanged: Set<SpriteModifier>): void {
    for (let spriteModifier of freshlyChanged) {
      this.keptSprites.add(
        SpriteFactory.createKeptSprite(spriteModifier, this.context)
      );
    }
  }

  finalizeSpriteCategories(): void {
    let insertedSpritesArr = [...this.insertedSprites];
    let removedSpritesArr = [...this.removedSprites];
    let insertedIds = insertedSpritesArr.map((s) => s.identifier);
    let removedIds = removedSpritesArr.map((s) => s.identifier);
    let intersectingIds = insertedIds.filter(
      (identifier) => !!removedIds.find((o) => o.equals(identifier))
    );
    for (let intersectingId of intersectingIds) {
      let removedSprites = removedSpritesArr.filter((s) =>
        s.identifier.equals(intersectingId)
      );
      let insertedSprite = insertedSpritesArr.find((s) =>
        s.identifier.equals(intersectingId)
      );
      if (!insertedSprite || removedSprites.length === 0) {
        throw new Error(
          'intersection check should always result in removedSprite and insertedSprite being found'
        );
      }
      this.insertedSprites.delete(insertedSprite);
      // TODO: verify if this is correct, we might need to handle it on a different level.
      //  We only get multiple ones in case of an interruption.
      if (removedSprites.length) {
        removedSprites.forEach((removedSprite) =>
          this.removedSprites.delete(removedSprite)
        );
      }

      // The first removedSprite should be the "last added orphan" if any
      let removedSprite = removedSprites[0];

      insertedSprite.type = SpriteType.Kept;
      insertedSprite.initialBounds = removedSprite.initialBounds;
      insertedSprite.initialComputedStyle = removedSprite.initialComputedStyle;
      removedSprite.finalBounds = insertedSprite.finalBounds;
      removedSprite.finalComputedStyle = insertedSprite.finalComputedStyle;
      insertedSprite.counterpart = removedSprite;
      this.keptSprites.add(insertedSprite);
    }
  }
}

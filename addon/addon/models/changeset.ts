import Sprite, { SpriteType } from './sprite';
import { assert } from '@ember/debug';
import { Context } from './sprite-tree';

export type SpritesForArgs = {
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

export default interface Changeset {
  context: Context;
  intent: string | undefined;
  insertedSprites: Set<Sprite>;
  removedSprites: Set<Sprite>;
  keptSprites: Set<Sprite>;
  spritesFor(filter: SpritesForArgs): Set<Sprite>;
  spriteFor(filter: SpritesForArgs): Sprite | null;
}

export class OldChangeset implements Changeset {
  context: Context;
  intent: string | undefined;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();

  constructor(animationContext: Context, intent: string | undefined) {
    this.context = animationContext;
    this.intent = intent;
  }

  addSprites(sprites: Sprite[]) {
    for (let sprite of sprites) {
      if (sprite.type === SpriteType.Kept) {
        this.keptSprites.add(sprite);
      } else if (sprite.type === SpriteType.Inserted) {
        this.insertedSprites.add(sprite);
      } else if (sprite.type === SpriteType.Removed) {
        this.removedSprites.add(sprite);
      }
    }
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
    return [...set][0] ?? null;
  }
}

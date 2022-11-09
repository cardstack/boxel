import Sprite, { SpriteType } from '@cardstack/boxel-motion/models/sprite';
import { assert } from '@ember/debug';
import { IContext } from '@cardstack/boxel-motion/models/sprite-tree';
import { Animator } from './animation-participant';

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

export class Changeset {
  context: IContext;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();

  constructor(context: IContext) {
    this.context = context;
  }

  get hasSprites() {
    return (
      this.insertedSprites.size ||
      this.removedSprites.size ||
      this.keptSprites.size
    );
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

export class ChangesetBuilder {
  contextToChangeset: WeakMap<IContext, Changeset> = new WeakMap();

  constructor(animators: Animator[], sprites: Sprite[]) {
    for (let animator of animators) {
      let things = animator.handleSprites(sprites);
      let changeset = new Changeset(animator.context);
      changeset.insertedSprites = things.insertedSprites;
      changeset.keptSprites = things.keptSprites;
      changeset.removedSprites = things.removedSprites;
      this.contextToChangeset.set(animator.context, changeset);
    }
  }
}

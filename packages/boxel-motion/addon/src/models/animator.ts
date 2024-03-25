import { assert } from '@ember/debug';

import { type Snapshot } from '../utils/measurement.ts';
import { type AnimationDefinition } from './orchestration.ts';
import Sprite, { SpriteType } from './sprite.ts';

export interface IContext {
  appendOrphan(spriteOrElement: Sprite): void;
  args: {
    id?: string;
    use?(changeset: Changeset): AnimationDefinition;
  };
  clearOrphans(): void;
  element: Element;
  hasOrphan(spriteOrElement: Sprite): boolean;
  id: string | undefined;
  // TODO can we change this to HTMLElement
  isInitialRenderCompleted: boolean;
  isStable: boolean;
  orphans: Map<string, HTMLElement>;
  removeOrphan(spriteOrElement: Sprite): void;
  shouldAnimate(): boolean;
}

// Currently this is just a wrapper around a context
// We already have a first pass that kicks out unstable contexts, but cloning introduces another layer that disables contexts
// when cloning is introduced, this can be used store state about whether this context should be allowed to animate
// We could try to introduce that right now for counterpart-animated stuff
export class Animator {
  private keptSprites: Set<Sprite> = new Set();
  private removedSprites: Set<Sprite> = new Set();
  private insertedSprites: Set<Sprite> = new Set();

  constructor(
    //   private participant: AnimationParticipant,
    public context: IContext,
    public _state: {
      final: Snapshot;
      initial: Snapshot;
    },
  ) {}

  handleSprites(sprites: Sprite[]) {
    for (let sprite of sprites) {
      if (sprite.defaultAnimator === this) {
        sprite.within(this);

        if (sprite.type === SpriteType.Inserted) {
          this.insertedSprites.add(sprite);
        } else if (sprite.type === SpriteType.Removed) {
          this.removedSprites.add(sprite);
        } else if (sprite.type === SpriteType.Kept) {
          this.keptSprites.add(sprite);
        } else {
          throw new Error(`Unexpected sprite type: ${sprite.type}`);
        }
      }
    }
  }

  toChangeset() {
    let changeset = new Changeset(this.context);
    changeset.insertedSprites = this.insertedSprites;
    changeset.keptSprites = this.keptSprites;
    changeset.removedSprites = this.removedSprites;
    return changeset;
  }
}

export type SpritesForArgs = {
  id?: string | undefined;
  role?: string | undefined;
  type?: SpriteType | undefined;
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
      criteria.type || criteria.role || criteria.id,
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
        `More than one sprite found matching criteria ${criteria}`,
      );
    }
    if (set.size === 0) {
      return null;
    }
    return [...set][0] ?? null;
  }
}

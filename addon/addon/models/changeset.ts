import Sprite, {
  SpriteIdentifier,
  SpriteType,
} from 'animations-experiment/models/sprite';
import { assert } from '@ember/debug';
import SpriteTree, {
  Context,
  GetDescendantNodesOptions,
  SpriteStateTracker,
  SpriteTreeNode,
} from 'animations-experiment/models/sprite-tree';
import ContextAwareBounds from 'animations-experiment/models/context-aware-bounds';
import { IntermediateSprite } from 'animations-experiment/services/animations';

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

// DESCENDANT ACCESS: exclusively used to get descendants to filter for descendants that should be included in a changeset
export function filterToContext(
  spriteTree: SpriteTree,
  animationContext: Context,
  spriteModifiers: Set<SpriteStateTracker>
): Set<SpriteStateTracker> {
  let node = spriteTree.lookupNodeByElement(animationContext.element);
  let contextDescendants = node!
    .getSpriteDescendants({ deep: true })
    .map((v) => v.spriteModifier);

  return new Set(
    [...spriteModifiers].filter((m) => contextDescendants.includes(m))
  );
}

export class Changeset {
  context: Context;
  intent: string | undefined;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();

  constructor(context: Context) {
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
  contextToChangeset: WeakMap<Context, Changeset> = new WeakMap();
  spriteTree: SpriteTree;

  constructor(
    spriteTree: SpriteTree,
    contexts: Set<Context>,
    freshlyAdded: Set<SpriteStateTracker>,
    freshlyRemoved: Set<SpriteStateTracker>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    this.spriteTree = spriteTree;

    // Capture snapshots & lookup natural KeptSprites
    let naturalKept: Set<SpriteStateTracker> = new Set();
    for (let context of contexts) {
      context.captureSnapshot();
      let contextNode = this.spriteTree.lookupNodeByElement(context.element);
      let contextChildren: SpriteStateTracker[] = contextNode!
        .getSpriteDescendants()
        .filter((v) => !v.isRemoved)
        .map((c) => c.spriteModifier);

      for (let spriteModifier of contextChildren) {
        spriteModifier.captureSnapshot({
          withAnimations: false,
          playAnimations: false,
        });

        if (!freshlyAdded.has(spriteModifier)) {
          naturalKept.add(spriteModifier);
        }
      }
    }

    let {
      spriteModifiers,
      spriteModifierToSpriteMap,
      spriteModifierToCounterpartModifierMap,
      contextToKeptSpriteModifierMap,
    } = this.classifySprites(
      freshlyAdded,
      freshlyRemoved,
      naturalKept,
      intermediateSprites
    );

    for (let context of contexts) {
      if (context.isStable) {
        let changeset = new Changeset(context);

        let spriteModifiersForContext = filterToContext(
          this.spriteTree,
          context,
          spriteModifiers
        );

        // add the sprites with counterparts here, if necessary
        if (contextToKeptSpriteModifierMap.has(context)) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          for (let modifier of contextToKeptSpriteModifierMap.get(context)!) {
            spriteModifiersForContext.add(modifier);
          }
        }

        for (let spriteModifier of spriteModifiersForContext) {
          let sprite = spriteModifierToSpriteMap.get(spriteModifier) as Sprite;
          let counterpartModifier =
            spriteModifierToCounterpartModifierMap.get(spriteModifier);
          let intermediateSprite = intermediateSprites.get(
            sprite.identifier.toString()
          );

          this.addSpriteTo(
            changeset,
            sprite,
            spriteModifier,
            context,
            counterpartModifier,
            intermediateSprite
          );
        }

        this.contextToChangeset.set(context, changeset);
      } else {
        // We already decided what contexts we're going to use for this render,
        // so we can mark new contexts for the next run.
        context.isInitialRenderCompleted = true;
      }
    }
  }

  classifySprites(
    freshlyAdded: Set<SpriteStateTracker>,
    freshlyRemoved: Set<SpriteStateTracker>,
    naturalKept: Set<SpriteStateTracker>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    let classifiedInsertedSpriteModifiers = new Set([...freshlyAdded]);
    let classifiedRemovedSpriteModifiers = new Set([...freshlyRemoved]);
    let classifiedKeptSpriteModifiers = new Set([...naturalKept]);

    let spriteModifiers: Set<SpriteStateTracker> = new Set();
    let spriteModifierToSpriteMap = new WeakMap<SpriteStateTracker, Sprite>();
    let spriteModifierToCounterpartModifierMap = new Map<
      SpriteStateTracker,
      SpriteStateTracker
    >();
    // non-natural kept sprites only
    let contextToKeptSpriteModifierMap = new WeakMap<
      Context,
      Set<SpriteStateTracker>
    >();

    // Classify non-natural KeptSprites
    for (let insertedSpriteModifier of classifiedInsertedSpriteModifiers) {
      // find a suitable RemovedSprite counterpart if any
      let removedSpriteModifiers = [...classifiedRemovedSpriteModifiers].filter(
        (removedSpriteModifier) =>
          new SpriteIdentifier(
            insertedSpriteModifier.id,
            insertedSpriteModifier.role
          ).equals(
            new SpriteIdentifier(
              removedSpriteModifier.id,
              removedSpriteModifier.role
            )
          )
      );

      assert(
        'Multiple matching removedSpriteModifiers found',
        removedSpriteModifiers.length < 2
      );

      let removedSpriteModifier = removedSpriteModifiers[0];
      if (removedSpriteModifier) {
        classifiedRemovedSpriteModifiers.delete(removedSpriteModifier);
      }

      let intermediateSprite = intermediateSprites.get(
        new SpriteIdentifier(
          insertedSpriteModifier.id,
          insertedSpriteModifier.role
        ).toString()
      );

      // a matching IntermediateSprite always wins from a RemovedSprite counterpart
      // as it is more up-to-date (mid-animation interruption).
      let counterpartSpriteModifier =
        intermediateSprite?.modifier ?? removedSpriteModifier;
      if (counterpartSpriteModifier) {
        classifiedKeptSpriteModifiers.add(insertedSpriteModifier);
        classifiedInsertedSpriteModifiers.delete(insertedSpriteModifier);

        // Find a stable shared ancestor ContextModel
        let sharedContext = this.spriteTree.findStableSharedAncestor(
          insertedSpriteModifier,
          counterpartSpriteModifier
        );

        if (!sharedContext) {
          console.warn(
            `Non-natural kept sprite with id ${insertedSpriteModifier.id} will not animate because there is no shared animation context that encloses both it and its counterpart`
          );
          continue;
        }

        let keptSprite = new Sprite(
          insertedSpriteModifier.element as HTMLElement,
          insertedSpriteModifier.id,
          insertedSpriteModifier.role,
          SpriteType.Kept
        );
        keptSprite.counterpart = new Sprite(
          counterpartSpriteModifier.element as HTMLElement,
          counterpartSpriteModifier.id,
          counterpartSpriteModifier.role,
          SpriteType.Removed
        );

        spriteModifierToSpriteMap.set(insertedSpriteModifier, keptSprite);
        spriteModifierToCounterpartModifierMap.set(
          insertedSpriteModifier,
          counterpartSpriteModifier
        );
        if (contextToKeptSpriteModifierMap.has(sharedContext)) {
          contextToKeptSpriteModifierMap
            .get(sharedContext)
            ?.add(insertedSpriteModifier);
        } else {
          contextToKeptSpriteModifierMap.set(
            sharedContext,
            new Set([insertedSpriteModifier])
          );
        }
      }
    }

    for (let insertedSpriteModifier of classifiedInsertedSpriteModifiers) {
      spriteModifiers.add(insertedSpriteModifier);
      spriteModifierToSpriteMap.set(
        insertedSpriteModifier,
        new Sprite(
          insertedSpriteModifier.element as HTMLElement,
          insertedSpriteModifier.id,
          insertedSpriteModifier.role,
          SpriteType.Inserted
        )
      );
    }

    for (let removedSpriteModifier of classifiedRemovedSpriteModifiers) {
      spriteModifiers.add(removedSpriteModifier);
      spriteModifierToSpriteMap.set(
        removedSpriteModifier,
        new Sprite(
          removedSpriteModifier.element as HTMLElement,
          removedSpriteModifier.id,
          removedSpriteModifier.role,
          SpriteType.Removed
        )
      );
    }

    for (let keptSpriteModifier of naturalKept) {
      assert(
        'Freshly changed sprite modifier has already been processed as a non-natural kept sprite',
        !spriteModifierToCounterpartModifierMap.has(keptSpriteModifier)
      );
      spriteModifiers.add(keptSpriteModifier);
      spriteModifierToSpriteMap.set(
        keptSpriteModifier,
        new Sprite(
          keptSpriteModifier.element as HTMLElement,
          keptSpriteModifier.id,
          keptSpriteModifier.role,
          SpriteType.Kept
        )
      );
    }

    return {
      spriteModifiers,
      spriteModifierToSpriteMap,
      spriteModifierToCounterpartModifierMap,
      contextToKeptSpriteModifierMap,
    };
  }

  addSpriteTo(
    node: Changeset,
    sprite: Sprite,
    spriteModifier: SpriteStateTracker,
    context: Context,
    counterpartModifier?: SpriteStateTracker,
    intermediateSprite?: IntermediateSprite
  ) {
    if (sprite.type === SpriteType.Kept) {
      assert(
        'kept sprite should have lastBounds and currentBounds',
        spriteModifier.lastBounds &&
          context.lastBounds &&
          spriteModifier.currentBounds &&
          context.currentBounds
      );

      if (intermediateSprite) {
        // If an interruption happened we set the intermediate sprite's bounds as the starting point.
        sprite.initialBounds = new ContextAwareBounds({
          element: intermediateSprite.intermediateBounds,
          contextElement: context.lastBounds,
        });
        sprite.initialComputedStyle = intermediateSprite.intermediateStyles;
      } else {
        sprite.initialBounds = new ContextAwareBounds({
          element: spriteModifier.lastBounds,
          contextElement: context.lastBounds,
        });
        sprite.initialComputedStyle = spriteModifier.lastComputedStyle;
      }

      sprite.finalBounds = new ContextAwareBounds({
        element: spriteModifier.currentBounds,
        contextElement: context.currentBounds,
      });
      sprite.finalComputedStyle = spriteModifier.currentComputedStyle;

      if (sprite.counterpart) {
        assert(
          'counterpart modifier should have been passed',
          counterpartModifier
        );
        assert(
          'kept sprite counterpart should have lastBounds and currentBounds',
          counterpartModifier.lastBounds && counterpartModifier.currentBounds
        );

        if (counterpartModifier) {
          if (intermediateSprite) {
            // If an interruption happened the counterpart starts at the same point as the sprite.
            sprite.counterpart.initialBounds = sprite.initialBounds;
            sprite.counterpart.initialComputedStyle =
              sprite.initialComputedStyle;
          } else {
            sprite.counterpart.initialBounds = new ContextAwareBounds({
              element: counterpartModifier.currentBounds,
              contextElement: context.lastBounds,
            });
            sprite.counterpart.initialComputedStyle =
              counterpartModifier.lastComputedStyle;

            // If we have a counterpart the sprite should start there.
            sprite.initialBounds = sprite.counterpart.initialBounds;
            sprite.initialComputedStyle =
              sprite.counterpart.initialComputedStyle;
          }
          sprite.counterpart.finalBounds = sprite.finalBounds;
          sprite.counterpart.finalComputedStyle = sprite.finalComputedStyle;
        }
      }

      node.keptSprites.add(sprite);
    } else if (sprite.type === SpriteType.Inserted) {
      assert(
        'inserted sprite should have currentBounds',
        spriteModifier.currentBounds && context.currentBounds
      );
      assert(
        'there should not be an intermediate sprite for an inserted sprite',
        !intermediateSprite
      );

      sprite.finalBounds = new ContextAwareBounds({
        element: spriteModifier.currentBounds,
        contextElement: context.currentBounds,
      });
      sprite.finalComputedStyle = spriteModifier.currentComputedStyle;

      node.insertedSprites.add(sprite);
    } else if (sprite.type === SpriteType.Removed) {
      assert(
        'removed sprite should have currentBounds',
        spriteModifier.currentBounds && context.lastBounds
      );

      if (intermediateSprite) {
        sprite.initialBounds = new ContextAwareBounds({
          element: intermediateSprite.intermediateBounds,
          contextElement: context.lastBounds,
        });
        sprite.initialComputedStyle = intermediateSprite.intermediateStyles;
      } else {
        sprite.initialBounds = new ContextAwareBounds({
          element: spriteModifier.currentBounds,
          contextElement: context.lastBounds,
        });
        sprite.initialComputedStyle = spriteModifier.currentComputedStyle;
      }

      node.removedSprites.add(sprite);
    }
  }
}

import Sprite, {
  SpriteIdentifier,
  SpriteType,
} from 'animations-experiment/models/sprite';
import { assert } from '@ember/debug';
import SpriteTree, {
  IContext,
  GetDescendantNodesOptions,
  ISpriteModifier,
  SpriteTreeNode,
} from 'animations-experiment/models/sprite-tree';
import ContextAwareBounds from 'animations-experiment/models/context-aware-bounds';
import { IntermediateSprite } from 'animations-experiment/services/animations';
import { AnimationDefinition } from './transition-runner';

export type SpritesForArgs = {
  type?: SpriteType | undefined;
  role?: string | undefined;
  id?: string | undefined;
};

function getOwnNode(spriteTree: SpriteTree, sprite: Sprite): SpriteTreeNode {
  return spriteTree.lookupNode(sprite)!;
}

function getHighestNode(
  spriteTree: SpriteTree,
  sprite: Sprite
): SpriteTreeNode {
  let ownNode = getOwnNode(spriteTree, sprite);
  if (!sprite.counterpart || sprite.counterpart.element === sprite.element) {
    return ownNode;
  } else {
    let counterpartNode = getOwnNode(spriteTree, sprite.counterpart);
    return counterpartNode.ancestors.length < ownNode.ancestors.length
      ? counterpartNode
      : ownNode;
  }
}

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
  intent: string | undefined;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();
  animationDefinitions: Set<AnimationDefinition> = new Set();

  constructor(context: IContext) {
    this.context = context;
  }

  get hasSprites() {
    return (
      this.insertedSprites.size ||
      this.removedSprites.size ||
      this.keptSprites.size ||
      this.animationDefinitions.size
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

  constructor(
    spriteTree: SpriteTree,
    contexts: Set<IContext>,
    freshlyAdded: Set<ISpriteModifier>,
    freshlyRemoved: Set<ISpriteModifier>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    ChangesetBuilder.measureAnimatingItems(spriteTree, contexts);

    let naturalKept = ChangesetBuilder.pickNaturalKeptSpriteModifiers(
      spriteTree,
      contexts,
      freshlyAdded
    );

    let sprites = ChangesetBuilder.createSprites(
      freshlyAdded,
      freshlyRemoved,
      naturalKept,
      intermediateSprites
    );

    let sortedContexts =
      ChangesetBuilder.createSortedAnimatingContextArray(contexts);
    let sortedChangesets = ChangesetBuilder.toChangesets(sortedContexts);

    // To not need to mock the sprite tree, we'd want to make it possible to
    // get the descendants of a context without having to read from the sprite tree
    // This will incur a perf hit, probably.
    // I think it's worth it until we're clear what kinds of rules we want.
    // Being able to test distribution of sprites without having to mock the sprite tree
    // Should make things a lot easier to iterate on
    // We'll need to do testing on getting up to this state, and distribution afterwards

    let remainingSprites = ChangesetBuilder.performRuleMatching(
      spriteTree,
      sortedChangesets,
      sprites
    );

    let leftoverSprites = ChangesetBuilder.distributeSprites(
      spriteTree,
      sortedChangesets,
      remainingSprites
    );

    if (leftoverSprites.length) {
      console.warn(
        'Some sprites were unable to be distributed to contexts and will not animate. This is likely to be because they or their counterparts are root nodes.',
        leftoverSprites
      );
    }

    this.contextToChangeset = ChangesetBuilder.toWeakMap(sortedChangesets);
  }

  static toWeakMap(changesets: Changeset[]): WeakMap<IContext, Changeset> {
    let contextToChangeset = new WeakMap<IContext, Changeset>();
    for (let changeset of changesets) {
      contextToChangeset.set(changeset.context, changeset);
    }

    return contextToChangeset;
  }

  /**
   * Distributes sprites, following "lowest stable context drives"
   */
  static distributeSprites(
    spriteTree: SpriteTree,
    sortedChangesets: Changeset[],
    sprites: Sprite[]
  ) {
    let cloned = [...sprites];
    for (let changeset of sortedChangesets) {
      let context = changeset.context;
      let node = spriteTree.lookupNode(context.element);
      let contextDescendants = node!
        .getSpriteDescendants({ deep: true })
        .map((v) => v.node);

      let _next = [];
      let itemsForContext: Sprite[] = [];
      for (let sprite of cloned) {
        if (contextDescendants.includes(getHighestNode(spriteTree, sprite))) {
          itemsForContext.push(sprite);
        } else {
          _next.push(sprite);
        }
      }
      cloned = _next;

      for (let sprite of itemsForContext) {
        let parentNode = getOwnNode(spriteTree, sprite).parent;
        let parent = parentNode.contextModel ?? parentNode.spriteModel!;

        assert(
          'Contexts should always be stable and have last and current bounds',
          context.lastBounds && context.currentBounds && context.isStable
        );

        sprite.within({
          parent: parent,
          contextElement: context,
        });
        ChangesetBuilder.addSpriteTo(changeset, sprite);
      }
    }

    return cloned;
  }

  /**
   * Creates AnimationDefinitions from matching sprites to rules, returns remaining sprites
   */
  static performRuleMatching(
    spriteTree: SpriteTree,
    sortedChangesets: Changeset[],
    sprites: Sprite[]
  ) {
    let cloned = [...sprites];

    for (let changeset of sortedChangesets) {
      let context = changeset.context;
      if (context.args.rules) {
        let contextNode = spriteTree.lookupNode(context.element)!;
        let descendants = contextNode.getDescendantNodes({
          includeFreshlyRemoved: true,
          filter: (_childNode: SpriteTreeNode) => true,
        });
        let spritesForContext: Sprite[] = [];
        let setAside: Sprite[] = [];
        cloned.forEach((sprite) => {
          let parentNode = getOwnNode(spriteTree, sprite).parent;
          let parent = parentNode.contextModel ?? parentNode.spriteModel!;
          sprite.within({
            parent,
            contextElement: context,
          });

          if (descendants.includes(getHighestNode(spriteTree, sprite))) {
            spritesForContext.push(sprite);
          } else {
            setAside.push(sprite);
          }
        });

        let animationDefinitions: AnimationDefinition[] = [];
        for (let rule of context.args.rules) {
          let { claimed, remaining } = rule.match(spritesForContext);
          animationDefinitions = animationDefinitions.concat(claimed);
          spritesForContext = remaining;
        }
        cloned = spritesForContext.concat(setAside);
        for (let animationDefinition of animationDefinitions) {
          ChangesetBuilder.addAnimationDefinitionTo(
            changeset,
            animationDefinition
          );
        }
      }
    }

    return cloned;
  }

  static measureAnimatingItems(
    spriteTree: SpriteTree,
    contexts: Set<IContext>
  ) {
    // Capture snapshots & lookup natural KeptSprites
    for (let context of contexts) {
      context.captureSnapshot();
      let contextNode = spriteTree.lookupNode(context.element);
      let contextChildren: ISpriteModifier[] = contextNode!
        .getSpriteDescendants()
        .filter((v) => !v.isRemoved)
        .map((c) => c.spriteModifier);

      for (let spriteModifier of contextChildren) {
        spriteModifier.captureSnapshot({
          withAnimations: false,
          playAnimations: false,
        });
      }
    }
  }

  static pickNaturalKeptSpriteModifiers(
    spriteTree: SpriteTree,
    contexts: Set<IContext>,
    freshlyAdded: Set<ISpriteModifier>
  ) {
    let naturalKeptModifiers: Set<ISpriteModifier> = new Set();

    for (let context of contexts) {
      let contextNode = spriteTree.lookupNode(context.element);
      let contextChildren: ISpriteModifier[] = contextNode!
        .getSpriteDescendants()
        .filter((v) => !v.isRemoved)
        .map((c) => c.spriteModifier);

      for (let spriteModifier of contextChildren) {
        if (!freshlyAdded.has(spriteModifier)) {
          naturalKeptModifiers.add(spriteModifier);
        }
      }
    }

    return naturalKeptModifiers;
  }

  /**
   * Creates an array of contexts that are able to animate. Array is sorted based on DOM hierarchy, top to bottom.
   * SIDE EFFECT - marks contexts as having completed their initial render
   */
  static createSortedAnimatingContextArray(contexts: Set<IContext>) {
    let contextArray: IContext[] = [];

    for (let context of contexts) {
      if (context.isStable) {
        contextArray.push(context);
      } else {
        // We already decided what contexts we're going to use for this render,
        // so we can mark new contexts for the next run.
        context.isInitialRenderCompleted = true;
      }
    }

    // Sort top to bottom
    contextArray.sort((a, b) => {
      let bitmask = a.element.compareDocumentPosition(b.element);

      assert(
        'Sorting contexts - Document position of two compared contexts is implementation-specific or disconnected',
        !(
          bitmask & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
          bitmask & Node.DOCUMENT_POSITION_DISCONNECTED
        )
      );

      return bitmask & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return contextArray;
  }

  static toChangesets(contextArray: IContext[]) {
    return contextArray.map((v) => new Changeset(v));
  }

  static createSprites(
    freshlyAdded: Set<ISpriteModifier>,
    freshlyRemoved: Set<ISpriteModifier>,
    naturalKept: Set<ISpriteModifier>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    let {
      spriteModifiers,
      spriteModifierToSpriteMap,
      spriteModifierToCounterpartModifierMap,
    } = ChangesetBuilder.classifySprites(
      freshlyAdded,
      freshlyRemoved,
      naturalKept,
      intermediateSprites
    );

    let sprites: Sprite[] = [];
    for (let spriteModifier of spriteModifiers) {
      let sprite = spriteModifierToSpriteMap.get(spriteModifier) as Sprite;
      let counterpartModifier =
        spriteModifierToCounterpartModifierMap.get(spriteModifier);
      let intermediateSprite = intermediateSprites.get(
        sprite.identifier.toString()
      );

      ChangesetBuilder.setSpriteOwnBounds(
        sprite,
        spriteModifier,
        counterpartModifier,
        intermediateSprite
      );

      sprites.push(sprite);
    }

    return sprites;
  }

  static addAnimationDefinitionTo(
    changeset: Changeset,
    animationDefinition: AnimationDefinition
  ) {
    changeset.animationDefinitions.add(animationDefinition);
  }

  static classifySprites(
    freshlyAdded: Set<ISpriteModifier>,
    freshlyRemoved: Set<ISpriteModifier>,
    naturalKept: Set<ISpriteModifier>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    let classifiedInsertedSpriteModifiers = new Set([...freshlyAdded]);
    let classifiedRemovedSpriteModifiers = new Set([...freshlyRemoved]);

    let spriteModifiers: Set<ISpriteModifier> = new Set();
    let spriteModifierToSpriteMap = new WeakMap<ISpriteModifier, Sprite>();
    let spriteModifierToCounterpartModifierMap = new Map<
      ISpriteModifier,
      ISpriteModifier
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
        classifiedInsertedSpriteModifiers.delete(insertedSpriteModifier);

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
        spriteModifiers.add(insertedSpriteModifier);
      }
    }

    for (let insertedSpriteModifier of classifiedInsertedSpriteModifiers) {
      spriteModifiers.add(insertedSpriteModifier);
      let insertedSprite = new Sprite(
        insertedSpriteModifier.element as HTMLElement,
        insertedSpriteModifier.id,
        insertedSpriteModifier.role,
        SpriteType.Inserted
      );
      spriteModifierToSpriteMap.set(insertedSpriteModifier, insertedSprite);
    }

    for (let removedSpriteModifier of classifiedRemovedSpriteModifiers) {
      spriteModifiers.add(removedSpriteModifier);
      let removedSprite = new Sprite(
        removedSpriteModifier.element as HTMLElement,
        removedSpriteModifier.id,
        removedSpriteModifier.role,
        SpriteType.Removed
      );
      spriteModifierToSpriteMap.set(removedSpriteModifier, removedSprite);
    }

    for (let keptSpriteModifier of naturalKept) {
      assert(
        'Freshly changed sprite modifier has already been processed as a non-natural kept sprite',
        !spriteModifierToCounterpartModifierMap.has(keptSpriteModifier)
      );
      spriteModifiers.add(keptSpriteModifier);
      let keptSprite = new Sprite(
        keptSpriteModifier.element as HTMLElement,
        keptSpriteModifier.id,
        keptSpriteModifier.role,
        SpriteType.Kept
      );
      spriteModifierToSpriteMap.set(keptSpriteModifier, keptSprite);
    }

    return {
      spriteModifiers,
      spriteModifierToSpriteMap,
      spriteModifierToCounterpartModifierMap,
    };
  }

  static addSpriteTo(changeset: Changeset, sprite: Sprite) {
    if (sprite.type === SpriteType.Kept) {
      changeset.keptSprites.add(sprite);
    } else if (sprite.type === SpriteType.Inserted) {
      changeset.insertedSprites.add(sprite);
    } else if (sprite.type === SpriteType.Removed) {
      changeset.removedSprites.add(sprite);
    } else {
      throw new Error('Unexpected sprite type received in changeset');
    }
  }

  static setSpriteOwnBounds(
    sprite: Sprite,
    spriteModifier: ISpriteModifier,
    counterpartModifier?: ISpriteModifier,
    intermediateSprite?: IntermediateSprite
  ): void {
    if (sprite.type === SpriteType.Kept) {
      assert(
        'kept sprite should have lastBounds and currentBounds',
        spriteModifier.lastBounds && spriteModifier.currentBounds
      );

      if (intermediateSprite) {
        // If an interruption happened we set the intermediate sprite's bounds as the starting point.
        sprite.initialBounds = new ContextAwareBounds({
          element: intermediateSprite.intermediateBounds,
        });
        sprite.initialComputedStyle = intermediateSprite.intermediateStyles;
      } else {
        sprite.initialBounds = new ContextAwareBounds({
          element: spriteModifier.lastBounds,
        });
        sprite.initialComputedStyle = spriteModifier.lastComputedStyle;
      }

      sprite.finalBounds = new ContextAwareBounds({
        element: spriteModifier.currentBounds,
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
    } else if (sprite.type === SpriteType.Inserted) {
      assert(
        'inserted sprite should have currentBounds',
        spriteModifier.currentBounds
      );
      assert(
        'there should not be an intermediate sprite for an inserted sprite',
        !intermediateSprite
      );

      sprite.finalBounds = new ContextAwareBounds({
        element: spriteModifier.currentBounds,
      });
      sprite.finalComputedStyle = spriteModifier.currentComputedStyle;
    } else if (sprite.type === SpriteType.Removed) {
      assert(
        'removed sprite should have currentBounds',
        spriteModifier.currentBounds
      );

      if (intermediateSprite) {
        sprite.initialBounds = new ContextAwareBounds({
          element: intermediateSprite.intermediateBounds,
        });
        sprite.initialComputedStyle = intermediateSprite.intermediateStyles;
      } else {
        sprite.initialBounds = new ContextAwareBounds({
          element: spriteModifier.currentBounds,
        });
        sprite.initialComputedStyle = spriteModifier.currentComputedStyle;
      }
    }
  }
}

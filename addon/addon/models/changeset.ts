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

export interface UnallocatedItems {
  sprite: Sprite;
  mainNode: SpriteTreeNode;
  parentNode: SpriteTreeNode | undefined;
  highestNode: SpriteTreeNode;
}

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
  spriteTree: SpriteTree;

  constructor(
    spriteTree: SpriteTree,
    contextSet: Set<IContext>,
    freshlyAdded: Set<ISpriteModifier>,
    freshlyRemoved: Set<ISpriteModifier>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    let contextArray = [...contextSet];
    this.spriteTree = spriteTree;

    // Capture snapshots & lookup natural KeptSprites
    let naturalKept: Set<ISpriteModifier> = new Set();
    for (let context of contextArray) {
      context.captureSnapshot();
      let contextNode = this.spriteTree.lookupNodeByElement(context.element);
      let contextChildren: ISpriteModifier[] = contextNode!
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
    } = this.classifySprites(
      freshlyAdded,
      freshlyRemoved,
      naturalKept,
      intermediateSprites
    );

    let unallocatedItems: UnallocatedItems[] = [];
    for (let spriteModifier of spriteModifiers) {
      let sprite = spriteModifierToSpriteMap.get(spriteModifier) as Sprite;
      let counterpartModifier =
        spriteModifierToCounterpartModifierMap.get(spriteModifier);
      let intermediateSprite = intermediateSprites.get(
        sprite.identifier.toString()
      );

      this.setSpriteOwnBounds(
        sprite,
        spriteModifier,
        counterpartModifier,
        intermediateSprite
      );

      let mainNode =
        sprite.type === SpriteType.Removed
          ? this.spriteTree.lookupRemovedNode(spriteModifier)!
          : this.spriteTree.lookupNodeByElement(spriteModifier.element)!;
      let highestNode = mainNode;
      let parentNode = mainNode.parent as SpriteTreeNode;

      // If this ever is the root of the sprite tree, then something's gone wrong
      // it shouldn't be included in change detection or animation
      assert(
        'Parent should be a sprite tree node',
        mainNode!.parent instanceof SpriteTreeNode
      );

      if (counterpartModifier) {
        let ancestorsOfKeptSprite = mainNode.ancestors;
        let stableAncestorsOfKeptSprite = ancestorsOfKeptSprite.filter(
          (v) => v.contextModel?.isStable
        );
        let counterpartNode =
          this.spriteTree.lookupRemovedNode(counterpartModifier)!;
        let ancestorsOfCounterpartSprite = counterpartNode.ancestors;
        let stableAncestorsOfCounterpartSprite =
          ancestorsOfCounterpartSprite?.filter((v) => v.contextModel?.isStable);

        let sharedContextNode = stableAncestorsOfKeptSprite?.find((v) =>
          stableAncestorsOfCounterpartSprite?.includes(v)
        );

        if (!sharedContextNode) {
          console.warn(
            `Non-natural kept sprite with id ${spriteModifier.id} will not animate because there is no shared animation context that encloses both it and its counterpart`
          );
          continue;
        }

        if (
          ancestorsOfCounterpartSprite?.length < ancestorsOfKeptSprite?.length
        ) {
          highestNode = counterpartNode;
        }
      }

      unallocatedItems.push({
        sprite,
        mainNode,
        highestNode,
        parentNode,
      });
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

    let animationDefinitionsPerContext = new Map<
      IContext,
      AnimationDefinition[]
    >();
    for (let context of contextArray) {
      if (context.isStable) {
        if (!context.args.use) {
          // nothing to do here
        } else if (context.args.use instanceof Function) {
          animationDefinitionsPerContext.set(context, []);
        } else {
          unallocatedItems.forEach(({ sprite, parentNode }) =>
            sprite.within({
              parent: parentNode!.contextModel! ?? parentNode!.spriteModel!,
              contextElement: context,
            })
          );
          let animationDefinitions: AnimationDefinition[] = [];
          for (let rule of context.args.use.rules) {
            let { claimed, remaining } = rule.match(unallocatedItems);
            animationDefinitions = animationDefinitions.concat(claimed);
            unallocatedItems = remaining;
          }
          animationDefinitionsPerContext.set(context, animationDefinitions);
        }
      } else {
        // We already decided what contexts we're going to use for this render,
        // so we can mark new contexts for the next run.
        context.isInitialRenderCompleted = true;
      }
    }

    for (let [context, claimed] of animationDefinitionsPerContext) {
      let changeset = new Changeset(context);

      let node = spriteTree.lookupNodeByElement(context.element);
      let contextDescendants = node!
        .getSpriteDescendants({ deep: true })
        .map((v) => v.spriteModifier);

      let _next = [];
      let itemsForContext: UnallocatedItems[] = [];
      for (let item of unallocatedItems) {
        if (contextDescendants.includes(item.highestNode.spriteModel!)) {
          itemsForContext.push(item);
        } else {
          _next.push(item);
        }
      }
      unallocatedItems = _next;

      for (let animationDefinition of claimed) {
        this.addAnimationDefinitionTo(changeset, animationDefinition);
      }

      for (let { parentNode, sprite } of itemsForContext) {
        // TODO: I don't think we can get this one right for sprites with counterparts
        // until we can tell that someone wants to use a counterpart/clone
        // and in that case, setting the parent of the node should happen only when
        // running the AnimationDefinition/transition function
        sprite.within({
          parent: parentNode!.contextModel! ?? parentNode!.spriteModel!,
          contextElement: context,
        });
        this.addSpriteTo(changeset, sprite);
      }

      this.contextToChangeset.set(context, changeset);
    }
  }
  addAnimationDefinitionTo(
    changeset: Changeset,
    animationDefinition: AnimationDefinition
  ) {
    changeset.animationDefinitions.add(animationDefinition);
  }

  classifySprites(
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
    };
  }

  addSpriteTo(changeset: Changeset, sprite: Sprite) {
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

  setSpriteOwnBounds(
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

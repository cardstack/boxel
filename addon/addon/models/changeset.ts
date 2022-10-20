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
import { AnimationDefinition } from './transition-runner';

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
  private nodesForSprite = new Map<
    Sprite,
    {
      own: SpriteTreeNode;
      highest: SpriteTreeNode;
    }
  >();

  constructor(
    spriteTree: SpriteTree,
    contexts: Set<IContext>,
    freshlyAdded: Set<ISpriteModifier>,
    freshlyRemoved: Set<ISpriteModifier>
  ) {
    let contextArray = [...contexts];
    this.spriteTree = spriteTree;

    // Capture snapshots & lookup natural KeptSprites
    let naturalKept: Set<ISpriteModifier> = new Set();
    for (let context of contexts) {
      context.captureSnapshot(false);
      let contextNode = this.spriteTree.lookupNodeByElement(context.element);
      let contextChildren: ISpriteModifier[] = contextNode!
        .getSpriteDescendants()
        .filter((v) => !v.isRemoved)
        .map((c) => c.spriteModifier);

      for (let spriteModifier of contextChildren) {
        spriteModifier.captureSnapshot(false, {
          withAnimations: false,
          playAnimations: false,
        });

        if (!freshlyAdded.has(spriteModifier)) {
          naturalKept.add(spriteModifier);
        }
      }
    }

    let sprites = this.createSprites(freshlyAdded, freshlyRemoved, naturalKept);

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
        if (!context.args.rules) {
          animationDefinitionsPerContext.set(context, []);
        } else {
          let contextNode = this.spriteTree.lookupNodeByElement(
            context.element
          )!;
          let descendants = contextNode.getDescendantNodes({
            includeFreshlyRemoved: true,
            filter: (_childNode: SpriteTreeNode) => true,
          });
          let spritesForContext: Sprite[] = [];
          let setAside: Sprite[] = [];
          sprites.forEach((sprite) => {
            let parentNode = this.nodesForSprite.get(sprite)!.own.parent;
            let parent = parentNode.contextModel ?? parentNode.spriteModel!;
            sprite.within({
              parent,
              contextElement: context,
            });

            if (
              descendants.includes(this.nodesForSprite.get(sprite)!.highest)
            ) {
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
          sprites = spritesForContext.concat(setAside);
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

      for (let animationDefinition of claimed) {
        this.addAnimationDefinitionTo(changeset, animationDefinition);
      }

      let node = spriteTree.lookupNodeByElement(context.element);
      let contextDescendants = node!
        .getSpriteDescendants({ deep: true })
        .map((v) => v.node);

      let _next = [];
      let itemsForContext: Sprite[] = [];
      for (let sprite of sprites) {
        if (
          contextDescendants.includes(this.nodesForSprite.get(sprite)!.highest)
        ) {
          itemsForContext.push(sprite);
        } else {
          _next.push(sprite);
        }
      }
      sprites = _next;

      for (let sprite of itemsForContext) {
        let parentNode = this.nodesForSprite.get(sprite)!.own.parent;
        let parent = parentNode.contextModel ?? parentNode.spriteModel!;

        assert(
          'Contexts should always be stable and have last and current bounds',
          context.boundsBeforeRender &&
            context.boundsAfterRender &&
            context.isStable
        );

        sprite.within({
          parent: parent,
          contextElement: context,
        });
        this.addSpriteTo(changeset, sprite);
      }

      this.contextToChangeset.set(context, changeset);
    }
  }

  createSprites(
    freshlyAdded: Set<ISpriteModifier>,
    freshlyRemoved: Set<ISpriteModifier>,
    naturalKept: Set<ISpriteModifier>
  ) {
    let {
      spriteModifiers,
      spriteModifierToSpriteMap,
      spriteModifierToCounterpartModifierMap,
    } = this.classifySprites(freshlyAdded, freshlyRemoved, naturalKept);

    let unallocatedItems: Sprite[] = [];
    for (let spriteModifier of spriteModifiers) {
      let sprite = spriteModifierToSpriteMap.get(spriteModifier) as Sprite;
      let counterpartModifier =
        spriteModifierToCounterpartModifierMap.get(spriteModifier);

      this.setSpriteOwnBounds(sprite, spriteModifier, counterpartModifier);

      unallocatedItems.push(sprite);
    }

    return unallocatedItems;
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
    naturalKept: Set<ISpriteModifier>
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

      let counterpartSpriteModifier = removedSpriteModifier;
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
        let keptSpriteNode = this.spriteTree.lookupNodeByElement(
          insertedSpriteModifier.element
        )!;
        let counterpartNode = this.spriteTree.lookupRemovedNode(
          counterpartSpriteModifier
        )!;

        let ancestorsOfKeptSprite = keptSpriteNode.ancestors;
        let stableAncestorsOfKeptSprite = ancestorsOfKeptSprite.filter(
          (v) => v.contextModel?.isStable
        );
        let ancestorsOfCounterpartSprite = counterpartNode.ancestors;
        let stableAncestorsOfCounterpartSprite =
          ancestorsOfCounterpartSprite?.filter((v) => v.contextModel?.isStable);

        let sharedContextNode = stableAncestorsOfKeptSprite?.find((v) =>
          stableAncestorsOfCounterpartSprite?.includes(v)
        );

        if (!sharedContextNode) {
          console.warn(
            `Non-natural kept sprite with id ${insertedSpriteModifier.id} will not animate because there is no shared animation context that encloses both it and its counterpart`
          );
        }

        let highestNode =
          ancestorsOfCounterpartSprite?.length < ancestorsOfKeptSprite?.length
            ? counterpartNode
            : keptSpriteNode;
        this.nodesForSprite.set(keptSprite, {
          own: keptSpriteNode,
          highest: highestNode,
        });
        this.nodesForSprite.set(keptSprite.counterpart, {
          own: counterpartNode,
          highest: highestNode,
        });

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
      let insertedSpriteNode = this.spriteTree.lookupNodeByElement(
        insertedSpriteModifier.element
      )!;
      spriteModifierToSpriteMap.set(insertedSpriteModifier, insertedSprite);
      this.nodesForSprite.set(insertedSprite, {
        own: insertedSpriteNode,
        highest: insertedSpriteNode,
      });
    }

    for (let removedSpriteModifier of classifiedRemovedSpriteModifiers) {
      spriteModifiers.add(removedSpriteModifier);
      let removedSprite = new Sprite(
        removedSpriteModifier.element as HTMLElement,
        removedSpriteModifier.id,
        removedSpriteModifier.role,
        SpriteType.Removed
      );
      let removedSpriteNode = this.spriteTree.lookupRemovedNode(
        removedSpriteModifier
      )!;
      spriteModifierToSpriteMap.set(removedSpriteModifier, removedSprite);
      this.nodesForSprite.set(removedSprite, {
        own: removedSpriteNode,
        highest: removedSpriteNode,
      });
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
      let keptSpriteNode = this.spriteTree.lookupNodeByElement(
        keptSpriteModifier.element
      )!;
      spriteModifierToSpriteMap.set(keptSpriteModifier, keptSprite);
      this.nodesForSprite.set(keptSprite, {
        own: keptSpriteNode,
        highest: keptSpriteNode,
      });
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
    counterpartModifier?: ISpriteModifier
  ): void {
    if (sprite.type === SpriteType.Kept) {
      // This is no longer true
      // assert(
      //   'kept sprite should have lastBounds and currentBounds',
      //   spriteModifier.boundsBeforeRender && spriteModifier.boundsAfterRender
      // );
      console.log(spriteModifier.boundsBeforeRender);
      sprite.initialBounds = new ContextAwareBounds({
        element: spriteModifier.boundsBeforeRender!,
      });
      sprite.initialComputedStyle = spriteModifier.lastComputedStyle;

      sprite.finalBounds = new ContextAwareBounds({
        element: spriteModifier.boundsAfterRender!,
      });
      sprite.finalComputedStyle = spriteModifier.currentComputedStyle;

      if (sprite.counterpart) {
        assert(
          'counterpart modifier should have been passed',
          counterpartModifier
        );
        sprite.counterpart.initialBounds = new ContextAwareBounds({
          element: counterpartModifier.boundsBeforeRender!,
        });
        sprite.counterpart.initialComputedStyle =
          counterpartModifier.lastComputedStyle;

        // If we have a counterpart the sprite should start there.
        sprite.initialBounds = sprite.counterpart.initialBounds;
        sprite.initialComputedStyle = sprite.counterpart.initialComputedStyle;
        sprite.counterpart.finalBounds = sprite.finalBounds;
        sprite.counterpart.finalComputedStyle = sprite.finalComputedStyle;
      }
    } else if (sprite.type === SpriteType.Inserted) {
      assert(
        'inserted sprite should have currentBounds',
        spriteModifier.boundsAfterRender
      );

      sprite.finalBounds = new ContextAwareBounds({
        element: spriteModifier.boundsAfterRender,
      });
      sprite.finalComputedStyle = spriteModifier.currentComputedStyle;
    } else if (sprite.type === SpriteType.Removed) {
      assert(
        'removed sprite should have bounds before render',
        spriteModifier.boundsBeforeRender
      );

      sprite.initialBounds = new ContextAwareBounds({
        element: spriteModifier.boundsBeforeRender,
      });
      sprite.initialComputedStyle = spriteModifier.currentComputedStyle;
    }
  }
}

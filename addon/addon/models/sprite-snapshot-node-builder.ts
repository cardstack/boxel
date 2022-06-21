import Sprite, {
  SpriteIdentifier,
  SpriteType,
} from 'animations-experiment/models/sprite';
import AnimationContext from 'animations-experiment/components/animation-context';
import SpriteTree, {
  GetDescendantNodesOptions,
  SpriteTreeNode,
} from 'animations-experiment/models/sprite-tree';
import SpriteModifier from 'animations-experiment/modifiers/sprite';
import { assert } from '@ember/debug';
import ContextAwareBounds from 'animations-experiment/models/context-aware-bounds';
import { IntermediateSprite } from 'animations-experiment/services/animations';

function checkForChanges(
  spriteModifier: SpriteModifier,
  animationContext: AnimationContext
): boolean {
  let spriteCurrent = spriteModifier.currentBounds;
  let spriteLast = spriteModifier.lastBounds;
  let contextCurrent = animationContext.currentBounds;
  let contextLast = animationContext.lastBounds;
  if (spriteCurrent && spriteLast && contextCurrent && contextLast) {
    let parentLeftChange = contextCurrent.left - contextLast.left;
    let parentTopChange = contextCurrent.top - contextLast.top;

    return (
      spriteCurrent.left - spriteLast.left - parentLeftChange !== 0 ||
      spriteCurrent.top - spriteLast.top - parentTopChange !== 0 ||
      spriteCurrent.width - spriteLast.width !== 0 ||
      spriteCurrent.height - spriteLast.height !== 0
    );
  }
  return true;
}

export function filterToContext(
  spriteTree: SpriteTree,
  animationContext: AnimationContext,
  spriteModifiers: Set<SpriteModifier>,
  opts: GetDescendantNodesOptions = { includeFreshlyRemoved: false }
): Set<SpriteModifier> {
  let contextDescendants = spriteTree.descendantsOf(animationContext, {
    ...opts,
    filter(childNode: SpriteTreeNode) {
      return !(
        childNode.isContext &&
        (childNode.contextModel as AnimationContext).isStable
      );
    },
  });
  return new Set(
    [...spriteModifiers].filter((m) => contextDescendants.includes(m))
  );
}

export class SpriteSnapshotNode {
  controllingContext: AnimationContext;
  insertedSprites: Set<Sprite> = new Set();
  removedSprites: Set<Sprite> = new Set();
  keptSprites: Set<Sprite> = new Set();

  constructor(context: AnimationContext) {
    this.controllingContext = context;
  }

  addSprite(
    sprite: Sprite,
    spriteModifier: SpriteModifier,
    context: AnimationContext,
    counterpartModifier?: SpriteModifier,
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

      this.keptSprites.add(sprite);
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

      this.insertedSprites.add(sprite);
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

      this.removedSprites.add(sprite);
    }
  }

  get hasSprites() {
    return (
      this.insertedSprites.size ||
      this.removedSprites.size ||
      this.keptSprites.size
    );
  }
}

export class SpriteSnapshotNodeBuilder {
  contextToNode: WeakMap<AnimationContext, SpriteSnapshotNode> = new WeakMap();
  spriteTree: SpriteTree;

  constructor(
    spriteTree: SpriteTree,
    contexts: Set<AnimationContext>,
    freshlyAdded: Set<SpriteModifier>,
    freshlyRemoved: Set<SpriteModifier>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    this.spriteTree = spriteTree;

    // Capture snapshots & lookup natural KeptSprites
    let freshlyChanged: Set<SpriteModifier> = new Set();
    for (let context of contexts) {
      context.captureSnapshot();
      let contextDescendants = this.spriteTree.descendantsOf(context);
      for (let contextDescendant of contextDescendants) {
        if (contextDescendant instanceof SpriteModifier) {
          let spriteModifier = contextDescendant as SpriteModifier;
          spriteModifier.captureSnapshot();
          // TODO: what about refactoring away checkForChanges and simply treating all leftover sprites in the SpriteTree as KeptSprites
          if (checkForChanges(spriteModifier, context)) {
            freshlyChanged.add(spriteModifier);
          }
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
      freshlyChanged,
      intermediateSprites
    );

    for (let context of contexts) {
      if (context.isStable) {
        let spriteSnapshotNode = new SpriteSnapshotNode(context);

        // TODO: add sprites for context
        let spriteModifiersForContext = filterToContext(
          this.spriteTree,
          context,
          spriteModifiers,
          {
            includeFreshlyRemoved: true,
          }
        );

        for (let spriteModifier of spriteModifiersForContext) {
          let sprite = spriteModifierToSpriteMap.get(spriteModifier) as Sprite;
          let counterpartModifier =
            spriteModifierToCounterpartModifierMap.get(spriteModifier);
          let intermediateSprite = intermediateSprites.get(
            sprite.identifier.toString()
          );

          spriteSnapshotNode.addSprite(
            sprite,
            spriteModifier,
            context,
            counterpartModifier,
            intermediateSprite
          );
        }

        this.contextToNode.set(context, spriteSnapshotNode);
      } else {
        // We already decided what contexts we're going to use for this render,
        // so we can mark new contexts for the next run.
        context.isInitialRenderCompleted = true;
      }
    }
  }

  classifySprites(
    freshlyAdded: Set<SpriteModifier>,
    freshlyRemoved: Set<SpriteModifier>,
    freshlyChanged: Set<SpriteModifier>,
    intermediateSprites: Map<string, IntermediateSprite>
  ) {
    let insertedSpritesArr = [...freshlyAdded];
    let removedSpritesArr = [...freshlyRemoved];

    let classifiedInsertedSpriteModifiers = new Set(insertedSpritesArr);
    let classifiedRemovedSpriteModifiers = new Set(removedSpritesArr);
    let classifiedKeptSpriteModifiers = new Set([...freshlyChanged]);

    let spriteModifiers: Set<SpriteModifier> = new Set();
    let spriteModifierToSpriteMap = new WeakMap<SpriteModifier, Sprite>();
    let spriteModifierToCounterpartModifierMap = new WeakMap<
      SpriteModifier,
      SpriteModifier
    >();

    // Collect intersecting sprite identifiers
    let insertedIds = insertedSpritesArr.map(
      (s) => new SpriteIdentifier(s.id, s.role)
    );
    let removedIds = removedSpritesArr.map(
      (s) => new SpriteIdentifier(s.id, s.role)
    );
    let intersectingIds = insertedIds.filter(
      (identifier) => !!removedIds.find((o) => o.equals(identifier))
    );

    for (let insertedSpriteModifier of classifiedInsertedSpriteModifiers) {
      let intermediateSprite = intermediateSprites.get(
        new SpriteIdentifier(
          insertedSpriteModifier.id,
          insertedSpriteModifier.role
        ).toString()
      );
      if (intermediateSprite) {
        classifiedInsertedSpriteModifiers.delete(insertedSpriteModifier);
        let keptSprite = new Sprite(
          insertedSpriteModifier.element as HTMLElement,
          insertedSpriteModifier.id,
          insertedSpriteModifier.role,
          SpriteType.Kept
        );
        keptSprite.counterpart = new Sprite(
          intermediateSprite.modifier.element as HTMLElement,
          intermediateSprite.modifier.id,
          intermediateSprite.modifier.role,
          SpriteType.Removed
        );
        spriteModifiers.add(insertedSpriteModifier);
        spriteModifierToSpriteMap.set(insertedSpriteModifier, keptSprite);
        spriteModifierToCounterpartModifierMap.set(
          insertedSpriteModifier,
          intermediateSprite.modifier
        );
      }
    }

    // Classify non-natural KeptSprites
    for (let intersectingId of intersectingIds) {
      let insertedSpriteModifier = insertedSpritesArr.find((s) =>
        new SpriteIdentifier(s.id, s.role).equals(intersectingId)
      );
      let removedSpriteModifiers = removedSpritesArr.filter((s) =>
        new SpriteIdentifier(s.id, s.role).equals(intersectingId)
      );

      assert(
        'Intersection check should always result in removedSpriteModifier and insertedSpriteModifier being found',
        !(!insertedSpriteModifier || removedSpriteModifiers.length === 0)
      );
      assert(
        'Multiple matching removedSpriteModifiers found',
        removedSpriteModifiers.length < 2
      );

      let removedSpriteModifier = removedSpriteModifiers[0] as SpriteModifier;
      classifiedKeptSpriteModifiers.add(insertedSpriteModifier);
      classifiedInsertedSpriteModifiers.delete(insertedSpriteModifier);
      classifiedRemovedSpriteModifiers.delete(removedSpriteModifier);

      let keptSprite = new Sprite(
        insertedSpriteModifier.element as HTMLElement,
        insertedSpriteModifier.id,
        insertedSpriteModifier.role,
        SpriteType.Kept
      );
      keptSprite.counterpart = new Sprite(
        removedSpriteModifier.element as HTMLElement,
        removedSpriteModifier.id,
        removedSpriteModifier.role,
        SpriteType.Removed
      );
      spriteModifiers.add(insertedSpriteModifier);
      spriteModifierToSpriteMap.set(insertedSpriteModifier, keptSprite);
      spriteModifierToCounterpartModifierMap.set(
        insertedSpriteModifier,
        removedSpriteModifier
      );
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

    for (let keptSpriteModifier of freshlyChanged) {
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
}

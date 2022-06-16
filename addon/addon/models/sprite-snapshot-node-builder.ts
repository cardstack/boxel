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

  addSprite(sprite: Sprite) {
    if (sprite.type === SpriteType.Kept) {
      this.keptSprites.add(sprite);
    } else if (sprite.type === SpriteType.Inserted) {
      this.insertedSprites.add(sprite);
    } else if (sprite.type === SpriteType.Removed) {
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
    freshlyRemoved: Set<SpriteModifier>
  ) {
    this.spriteTree = spriteTree;

    // Lookup natural KeptSprites
    let freshlyChanged: Set<SpriteModifier> = new Set();
    for (let context of contexts) {
      context.captureSnapshot();
      let contextDescendants = this.spriteTree.descendantsOf(context);
      for (let contextDescendant of contextDescendants) {
        if (contextDescendant instanceof SpriteModifier) {
          let spriteModifier = contextDescendant as SpriteModifier;
          spriteModifier.captureSnapshot();
          if (checkForChanges(spriteModifier, context)) {
            freshlyChanged.add(spriteModifier);
          }
        }
      }
    }

    let { spriteModifiers, spriteModifierToSpriteMap } = this.classifySprites(
      freshlyAdded,
      freshlyRemoved,
      freshlyChanged
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
          spriteSnapshotNode.addSprite(
            spriteModifierToSpriteMap.get(spriteModifier) as Sprite
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
    freshlyChanged: Set<SpriteModifier>
  ) {
    let insertedSpritesArr = [...freshlyAdded];
    let removedSpritesArr = [...freshlyRemoved];

    let classifiedInsertedSpriteModifiers = new Set(insertedSpritesArr);
    let classifiedRemovedSpriteModifiers = new Set(removedSpritesArr);
    let classifiedKeptSpriteModifiers = new Set([...freshlyChanged]);

    let spriteModifiers: Set<SpriteModifier> = new Set();
    let spriteModifierToSpriteMap = new WeakMap<SpriteModifier, Sprite>();

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
    };
  }
}

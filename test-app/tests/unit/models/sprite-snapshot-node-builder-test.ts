import { module, test } from 'qunit';
import SpriteTree, {
  Context,
  SpriteStateTracker,
} from 'animations-experiment/models/sprite-tree';
import Changeset, {
  ChangesetBuilder,
} from 'animations-experiment/models/changeset';
import Sprite, { SpriteIdentifier } from 'animations-experiment/models/sprite';
import { IntermediateSprite } from 'animations-experiment/services/animations';
import { CopiedCSS } from 'animations-experiment/utils/measurement';
import ContextAwareBounds from 'animations-experiment/models/context-aware-bounds';

class MockAnimationContext implements Context {
  id: string | undefined;
  element: HTMLElement;
  isAnimationContext = true;
  isStable = true;
  isInitialRenderCompleted = false;
  lastBounds: DOMRect | undefined = undefined;
  currentBounds = new DOMRect(0, 0, 0, 0);
  nextBounds = new DOMRect(0, 0, 0, 0);
  args = {};

  constructor(
    parentEl: HTMLElement | null = null,
    id: string | undefined = undefined,
    element: HTMLElement | null = null
  ) {
    this.element = element ?? document.createElement('div');
    if (parentEl) {
      parentEl.appendChild(this.element);
    }
    this.id = id;
  }

  shouldAnimate(): boolean {
    throw new Error('Method not implemented.');
  }

  hasOrphan(_sprite: Sprite): boolean {
    throw new Error('Method not implemented.');
  }

  removeOrphan(_sprite: Sprite): void {
    throw new Error('Method not implemented.');
  }

  appendOrphan(_sprite: Sprite): void {
    throw new Error('Method not implemented.');
  }

  clearOrphans(): void {
    throw new Error('Method not implemented.');
  }

  captureSnapshot() {
    this.lastBounds = this.currentBounds;
    this.currentBounds = new DOMRect(
      this.nextBounds.x,
      this.nextBounds.y,
      this.nextBounds.width,
      this.nextBounds.height
    );
  }

  stable() {
    this.isStable = true;
    return this;
  }

  willTransformInto(domrect: DOMRect) {
    this.nextBounds = domrect;
    return this;
  }

  unstable() {
    this.isStable = false;
    return this;
  }
}

class MockSpriteModifier implements SpriteStateTracker {
  element: HTMLElement;
  id: string;
  lastBounds: DOMRect | undefined = undefined;
  currentBounds = new DOMRect(0, 0, 0, 0);
  nextBounds = new DOMRect(0, 0, 0, 0);

  constructor(
    parentEl: HTMLElement | null = null,
    id = 'Mock',
    element: HTMLElement | null = null
  ) {
    this.element = element ?? document.createElement('div');
    this.id = id;
    if (parentEl) {
      parentEl.appendChild(this.element);
    }
  }
  role: string | null = null;
  lastComputedStyle: CopiedCSS | undefined;
  currentComputedStyle: CopiedCSS | undefined;

  willTransformInto(domrect: DOMRect) {
    this.nextBounds = domrect;
    return this;
  }

  captureSnapshot() {
    this.lastBounds = this.currentBounds;
    this.currentBounds = new DOMRect(
      this.nextBounds.x,
      this.nextBounds.y,
      this.nextBounds.width,
      this.nextBounds.height
    );
  }
}

function nestEachInPrevious(
  rootElement: HTMLElement,
  items: {
    element: HTMLElement;
  }[]
) {
  let previousDiv = rootElement;
  for (let item of items) {
    let div = item.element;
    previousDiv.appendChild(div);
    previousDiv = div;
  }
  return items;
}

module('Unit | Util | SpriteSnapshotNodeBuilder', function () {
  test('it divvies sprites up between contexts correctly', async function (assert) {
    let rootDiv = document.createElement('div');
    let context1NextDOMRect = new DOMRect(0, 0, 0, 1);
    let stableContext1 = new MockAnimationContext(
      rootDiv,
      'stable-context-1',
      null
    )
      .stable()
      .willTransformInto(context1NextDOMRect);
    let context2NextDOMRect = new DOMRect(0, 0, 1, 0);
    let stableContext2 = new MockAnimationContext(
      stableContext1.element,
      'stable-context-2',
      null
    )
      .stable()
      .willTransformInto(context2NextDOMRect);

    let freshlyRemovedSprite = new MockSpriteModifier(
      null,
      'modifier-removed',
      null
    );
    freshlyRemovedSprite.captureSnapshot();
    let freshlyAddedSprite = new MockSpriteModifier(
      null,
      'modifier-added',
      null
    );

    let modifiersForContext1 = nestEachInPrevious(stableContext1.element, [
      new MockSpriteModifier(null, 'modifier-kept-1', null).willTransformInto(
        new DOMRect(0, 4, 0, 0)
      ),
      freshlyRemovedSprite,
    ]);
    let modifiersForContext2 = nestEachInPrevious(stableContext2.element, [
      freshlyAddedSprite,
    ]);

    let spriteTree = new SpriteTree();
    for (let item of [
      stableContext1,
      stableContext2,
      ...modifiersForContext1,
      ...modifiersForContext2,
    ]) {
      if (item instanceof MockSpriteModifier) {
        spriteTree.addPendingSpriteModifier(item);
      } else if (item instanceof MockAnimationContext) {
        spriteTree.addPendingAnimationContext(item);
      }
    }
    spriteTree.flushPendingAdditions();
    spriteTree.removeSpriteModifier(freshlyRemovedSprite);

    let changesetBuilder = new ChangesetBuilder(
      spriteTree,
      new Set([stableContext1, stableContext2]),
      new Set([freshlyAddedSprite]),
      new Set([freshlyRemovedSprite]),
      new Map()
    );

    let context1Node = changesetBuilder.contextToNode.get(
      stableContext1
    ) as Changeset;
    let context2Node = changesetBuilder.contextToNode.get(
      stableContext2
    ) as Changeset;

    assert.equal(
      context1Node.insertedSprites.size,
      0,
      'No inserted sprites in context 1'
    );
    assert.equal(
      context1Node.removedSprites.size,
      1,
      'One removed sprite in context 1'
    );
    let removedSprite = [...context1Node.removedSprites][0];
    assert.equal(
      removedSprite?.id,
      'modifier-removed',
      'Removed sprite in context 1 has correct id'
    );
    assert.deepEqual(
      removedSprite?.initialBounds,
      new ContextAwareBounds({
        element: new DOMRect(0, 0, 0, 0),
        contextElement: new DOMRect(0, 0, 0, 0),
      })
    );
    assert.equal(removedSprite?.finalBounds, undefined);

    assert.equal(
      context1Node.keptSprites.size,
      1,
      'One kept sprite in context 1'
    );
    let keptSprite = [...context1Node.keptSprites][0];
    assert.equal(
      keptSprite?.id,
      'modifier-kept-1',
      'Kept sprite in context 1 has correct id'
    );
    assert.deepEqual(
      keptSprite?.initialBounds,
      new ContextAwareBounds({
        element: new DOMRect(0, 0, 0, 0),
        contextElement: new DOMRect(0, 0, 0, 0),
      })
    );
    assert.deepEqual(
      keptSprite?.finalBounds,
      new ContextAwareBounds({
        element: new DOMRect(0, 4, 0, 0),
        contextElement: context1NextDOMRect,
      })
    );

    assert.equal(
      context2Node.insertedSprites.size,
      1,
      'One inserted sprite in context 2'
    );
    let insertedSprite = [...context2Node.insertedSprites][0];
    assert.equal(
      insertedSprite?.id,
      'modifier-added',
      'Inserted sprite in context 2 has correct id'
    );
    assert.equal(insertedSprite?.initialBounds, undefined);
    assert.deepEqual(
      insertedSprite?.finalBounds,
      new ContextAwareBounds({
        element: new DOMRect(0, 0, 0, 0),
        contextElement: context2NextDOMRect,
      })
    );
    assert.equal(
      context2Node.removedSprites.size,
      0,
      'No removed sprites in context 2'
    );
  });

  test('it correctly identifies natural kept sprites', async function (assert) {
    let rootDiv = document.createElement('div');
    let movedContext = new MockAnimationContext(rootDiv, 'moved-context', null)
      .stable()
      .willTransformInto(new DOMRect(0, 4, 0, 0));
    let unmovedContext = new MockAnimationContext(
      rootDiv,
      'unmoved-context',
      null
    ).stable();

    let modifiersForMovedContext = nestEachInPrevious(movedContext.element, [
      new MockSpriteModifier(null, 'modifier-did-not-move-with-context', null),
    ]);

    // freshly added sprite in case there is a bug that can include added sprites in kept sprites
    let freshlyAddedSprite = new MockSpriteModifier(
      unmovedContext.element,
      'modifier-added',
      null
    );
    let modifiersForUnmovedContext = nestEachInPrevious(
      unmovedContext.element,
      [
        new MockSpriteModifier(
          null,
          'modifier-moved-independent-of-context',
          null
        ).willTransformInto(new DOMRect(0, 4, 0, 0)),
        new MockSpriteModifier(null, 'modifier-did-not-move', null),
        freshlyAddedSprite,
      ]
    );

    let spriteTree = new SpriteTree();
    for (let item of [
      movedContext,
      unmovedContext,
      ...modifiersForMovedContext,
      ...modifiersForUnmovedContext,
    ]) {
      if (item instanceof MockSpriteModifier) {
        spriteTree.addPendingSpriteModifier(item);
      } else if (item instanceof MockAnimationContext) {
        spriteTree.addPendingAnimationContext(item);
      }
    }
    spriteTree.flushPendingAdditions();

    let changesetBuilder = new ChangesetBuilder(
      spriteTree,
      new Set([movedContext, unmovedContext]),
      new Set([freshlyAddedSprite]),
      new Set(),
      new Map()
    );

    let movedContextNode = changesetBuilder.contextToNode.get(
      movedContext
    ) as Changeset;
    let unmovedContextNode = changesetBuilder.contextToNode.get(
      unmovedContext
    ) as Changeset;

    assert.ok(
      movedContextNode.insertedSprites.size === 0 &&
        movedContextNode.removedSprites.size === 0,
      'No inserted sprites or removed sprites in moved context'
    );
    assert.equal(
      movedContextNode.keptSprites.size,
      1,
      'One kept sprite in moved context'
    );
    assert.equal(
      [...movedContextNode.keptSprites][0]?.id,
      'modifier-did-not-move-with-context',
      'Kept sprite in moved context has correct id'
    );

    assert.equal(
      unmovedContextNode.removedSprites.size,
      0,
      'No removed sprites in unmoved context'
    );
    assert.equal(
      unmovedContextNode.insertedSprites.size,
      1,
      'One inserted sprite in unmoved context'
    );
    assert.equal(
      unmovedContextNode.keptSprites.size,
      1,
      'One kept sprite in unmoved context'
    );
    assert.equal(
      [...unmovedContextNode.keptSprites][0]?.id,
      'modifier-moved-independent-of-context',
      'Kept sprite in unmoved context has correct id'
    );
  });

  test('it correctly identifies unstable contexts and marks them as having completed their first render', async function (assert) {
    let rootDiv = document.createElement('div');
    let stableContext = new MockAnimationContext(
      rootDiv,
      'stable-context-1',
      null
    ).stable();
    let unstableContext = new MockAnimationContext(
      rootDiv,
      'stable-context-2',
      null
    ).unstable();
    let spriteTree = new SpriteTree();
    spriteTree.addPendingAnimationContext(unstableContext);
    spriteTree.addPendingAnimationContext(stableContext);
    spriteTree.flushPendingAdditions();

    assert.equal(
      unstableContext.isInitialRenderCompleted,
      false,
      'Unstable context does not have initial render completed yet'
    );

    let changesetBuilder = new ChangesetBuilder(
      spriteTree,
      new Set([stableContext, unstableContext]),
      new Set(),
      new Set(),
      new Map()
    );

    assert.ok(
      changesetBuilder.contextToNode.get(stableContext),
      'Stable context is in the contextToNode map'
    );
    assert.notOk(
      changesetBuilder.contextToNode.get(unstableContext),
      'Stable context is not in the contextToNode map'
    );
    assert.equal(
      unstableContext.isInitialRenderCompleted,
      true,
      'Unstable context marked as having initial render completed'
    );
  });

  test('it reconciles matching Removed and Inserted sprites into a Kept sprite', async function (assert) {
    let rootDiv = document.createElement('div');
    let outerContextNextDOMRect = new DOMRect(0, 0, 0, 1);
    let outerContext = new MockAnimationContext(rootDiv, 'outer-context', null)
      .stable()
      .willTransformInto(outerContextNextDOMRect);
    let innerContextNextDOMRect = new DOMRect(0, 0, 1, 0);
    let innerContext = new MockAnimationContext(
      outerContext.element,
      'inner-context',
      null
    )
      .stable()
      .willTransformInto(innerContextNextDOMRect);

    let freshlyRemovedNextDOMRect = new DOMRect(1, 1, 0, 0);
    let freshlyRemovedSprite = new MockSpriteModifier(
      outerContext.element,
      'modifier-kept',
      null
    ).willTransformInto(freshlyRemovedNextDOMRect);
    freshlyRemovedSprite.captureSnapshot();
    let freshlyAddedNextDOMRect = new DOMRect(0, 0, 1, 0);
    let freshlyAddedSprite = new MockSpriteModifier(
      innerContext.element,
      'modifier-kept',
      null
    ).willTransformInto(freshlyAddedNextDOMRect);

    let spriteTree = new SpriteTree();
    spriteTree.addPendingAnimationContext(outerContext);
    spriteTree.addPendingAnimationContext(innerContext);
    spriteTree.addPendingSpriteModifier(freshlyRemovedSprite);
    spriteTree.addPendingSpriteModifier(freshlyAddedSprite);
    spriteTree.flushPendingAdditions();
    spriteTree.removeSpriteModifier(freshlyRemovedSprite);

    let spriteSnapshotTree = new ChangesetBuilder(
      spriteTree,
      new Set([outerContext, innerContext]),
      new Set([freshlyAddedSprite]),
      new Set([freshlyRemovedSprite]),
      new Map()
    );

    let outerContextNode = spriteSnapshotTree.contextToNode.get(
      outerContext
    ) as Changeset;
    let innerContextNode = spriteSnapshotTree.contextToNode.get(
      innerContext
    ) as Changeset;
    assert.ok(
      outerContextNode.insertedSprites.size === 0 &&
        outerContextNode.removedSprites.size === 0 &&
        outerContextNode.keptSprites.size === 1,
      'Only a single kept sprite in outer context'
    );
    assert.ok(
      innerContextNode.insertedSprites.size === 0 &&
        innerContextNode.removedSprites.size === 0 &&
        innerContextNode.keptSprites.size === 0,
      'No sprites in inner context'
    );
    let keptSprite = [...outerContextNode.keptSprites][0];
    assert.equal(keptSprite!.id, 'modifier-kept', 'Kept sprite has correct id');
    assert.deepEqual(
      keptSprite?.initialBounds,
      new ContextAwareBounds({
        element: freshlyRemovedNextDOMRect,
        contextElement: new DOMRect(),
      })
    );
    assert.deepEqual(
      keptSprite?.finalBounds,
      new ContextAwareBounds({
        element: freshlyAddedNextDOMRect,
        contextElement: outerContextNextDOMRect,
      })
    );
    assert.deepEqual(
      keptSprite?.counterpart?.initialBounds,
      new ContextAwareBounds({
        element: freshlyRemovedNextDOMRect,
        contextElement: new DOMRect(),
      })
    );
    assert.deepEqual(
      keptSprite?.counterpart?.finalBounds,
      new ContextAwareBounds({
        element: freshlyAddedNextDOMRect,
        contextElement: outerContextNextDOMRect,
      })
    );
  });

  test('it identifies kept sprites from intermediate sprites', async function (assert) {
    let rootDiv = document.createElement('div');
    let outerContextNextDOMRect = new DOMRect(0, 0, 0, 1);
    let outerContext = new MockAnimationContext(rootDiv, 'outer-context', null)
      .stable()
      .willTransformInto(outerContextNextDOMRect);
    let innerContextNextDOMRect = new DOMRect(0, 0, 1, 0);
    let innerContext = new MockAnimationContext(
      outerContext.element,
      'inner-context',
      null
    )
      .stable()
      .willTransformInto(innerContextNextDOMRect);

    // TODO: add some intermediate sprites with removed sprites to ensure that the classification is correct
    let controlSpriteFromPreviousRender = new MockSpriteModifier(
      outerContext.element,
      'modifier-control',
      null
    );
    let freshlyRemovedSprite = new MockSpriteModifier(
      outerContext.element,
      'modifier-control',
      null
    );
    freshlyRemovedSprite.captureSnapshot();
    let spriteFromPreviousRenderNextDOMRect = new DOMRect(1, 1, 1, 1);
    let spriteFromPreviousRender = new MockSpriteModifier(
      outerContext.element,
      'modifier-kept-from-intermediate',
      null
    );
    spriteFromPreviousRender.captureSnapshot();
    let freshlyChangedSpriteModifier = new MockSpriteModifier(
      innerContext.element,
      'modifier-kept-from-intermediate',
      null
    ).willTransformInto(new DOMRect(0, 1, 1, 0));

    let spriteTree = new SpriteTree();
    spriteTree.addPendingAnimationContext(outerContext);
    spriteTree.addPendingAnimationContext(innerContext);
    spriteTree.addPendingSpriteModifier(freshlyChangedSpriteModifier);
    spriteTree.addPendingSpriteModifier(freshlyRemovedSprite);
    spriteTree.flushPendingAdditions();
    spriteTree.removeSpriteModifier(freshlyRemovedSprite);

    let spriteSnapshotTree = new ChangesetBuilder(
      spriteTree,
      new Set([outerContext, innerContext]),
      new Set([]),
      new Set([freshlyRemovedSprite]),
      new Map<string, IntermediateSprite>([
        [
          new SpriteIdentifier(
            'modifier-kept-from-intermediate',
            null
          ).toString(),
          {
            modifier: spriteFromPreviousRender,
            intermediateBounds: spriteFromPreviousRenderNextDOMRect,
            intermediateStyles: {} as CopiedCSS,
          } as IntermediateSprite,
        ],
        [
          new SpriteIdentifier('modifier-control', null).toString(),
          {
            modifier: controlSpriteFromPreviousRender,
            intermediateBounds: new DOMRect(),
            intermediateStyles: {} as CopiedCSS,
          } as IntermediateSprite,
        ],
      ])
    );

    let outerContextNode = spriteSnapshotTree.contextToNode.get(
      outerContext
    ) as Changeset;
    let innerContextNode = spriteSnapshotTree.contextToNode.get(
      innerContext
    ) as Changeset;
    assert.ok(
      outerContextNode.insertedSprites.size === 0 &&
        outerContextNode.removedSprites.size === 1 &&
        outerContextNode.keptSprites.size === 0,
      'One removed sprite in outer context'
    );
    assert.equal(
      [...outerContextNode.removedSprites][0]!.id,
      'modifier-control'
    );
    assert.ok(
      innerContextNode.insertedSprites.size === 0 &&
        innerContextNode.removedSprites.size === 0 &&
        innerContextNode.keptSprites.size === 1,
      'Only a single kept sprite in inner context'
    );
    let keptSprite = [...innerContextNode.keptSprites][0];
    assert.equal(keptSprite?.id, 'modifier-kept-from-intermediate');
    assert.deepEqual(
      keptSprite?.initialBounds,
      new ContextAwareBounds({
        element: spriteFromPreviousRenderNextDOMRect,
        contextElement: new DOMRect(),
      }),
      'kept sprite intiial bounds are ok'
    );
    assert.deepEqual(
      keptSprite?.finalBounds,
      new ContextAwareBounds({
        element: new DOMRect(0, 1, 1, 0),
        contextElement: innerContextNextDOMRect,
      }),
      'kept sprite final bounds are ok'
    );
    assert.equal(keptSprite?.counterpart, null, 'counterpart does not exist');
  });
});

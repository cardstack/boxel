import { module, test } from 'qunit';
import SpriteTree, {
  IContext,
  ISpriteModifier,
} from '@cardstack/boxel-motion/models/sprite-tree';
import {
  Changeset,
  ChangesetBuilder,
} from '@cardstack/boxel-motion/models/changeset';
import Sprite, {
  SpriteIdentifier,
} from '@cardstack/boxel-motion/models/sprite';
import { IntermediateSprite } from '@cardstack/boxel-motion/services/animations';
import { CopiedCSS } from '@cardstack/boxel-motion/utils/measurement';
import ContextAwareBounds from '@cardstack/boxel-motion/models/context-aware-bounds';

class MockAnimationContext implements IContext {
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
  orphans: Map<string, HTMLElement> = new Map();

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

class MockSpriteModifier implements ISpriteModifier {
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

module('Unit | Util | ChangesetBuilder', function () {
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

    let context1Changeset = changesetBuilder.contextToChangeset.get(
      stableContext1
    ) as Changeset;
    let context2Changeset = changesetBuilder.contextToChangeset.get(
      stableContext2
    ) as Changeset;

    assert.equal(
      context1Changeset.insertedSprites.size,
      0,
      'No inserted sprites in context 1'
    );
    assert.equal(
      context1Changeset.removedSprites.size,
      1,
      'One removed sprite in context 1'
    );
    let removedSprite = [...context1Changeset.removedSprites][0];
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
        parent: new DOMRect(0, 0, 0, 0),
      })
    );
    assert.equal(removedSprite?.finalBounds, undefined);

    assert.equal(
      context1Changeset.keptSprites.size,
      1,
      'One kept sprite in context 1'
    );
    let keptSprite = [...context1Changeset.keptSprites][0];
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
        parent: new DOMRect(0, 0, 0, 0),
      })
    );
    assert.deepEqual(
      keptSprite?.finalBounds,
      new ContextAwareBounds({
        element: new DOMRect(0, 4, 0, 0),
        contextElement: context1NextDOMRect,
        parent: context1NextDOMRect,
      })
    );

    assert.equal(
      context2Changeset.insertedSprites.size,
      1,
      'One inserted sprite in context 2'
    );
    let insertedSprite = [...context2Changeset.insertedSprites][0];
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
        parent: context2NextDOMRect,
      })
    );
    assert.equal(
      context2Changeset.removedSprites.size,
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

    let movedContextChangeset = changesetBuilder.contextToChangeset.get(
      movedContext
    ) as Changeset;
    let unmovedContextChangeset = changesetBuilder.contextToChangeset.get(
      unmovedContext
    ) as Changeset;

    assert.ok(
      movedContextChangeset.insertedSprites.size === 0 &&
        movedContextChangeset.removedSprites.size === 0,
      'No inserted sprites or removed sprites in moved context'
    );
    assert.equal(
      movedContextChangeset.keptSprites.size,
      1,
      'One kept sprite in moved context'
    );
    assert.equal(
      [...movedContextChangeset.keptSprites][0]?.id,
      'modifier-did-not-move-with-context',
      'Kept sprite in moved context has correct id'
    );

    assert.equal(
      unmovedContextChangeset.removedSprites.size,
      0,
      'No removed sprites in unmoved context'
    );
    assert.equal(
      unmovedContextChangeset.insertedSprites.size,
      1,
      'One inserted sprite in unmoved context'
    );
    assert.deepEqual(
      [...unmovedContextChangeset.keptSprites].map((v) => v.id).sort(),
      ['modifier-did-not-move', 'modifier-moved-independent-of-context'],
      'Kept sprites in unmoved context have correct ids'
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
      changesetBuilder.contextToChangeset.get(stableContext),
      'Stable context is in the contextToChangeset map'
    );
    assert.notOk(
      changesetBuilder.contextToChangeset.get(unstableContext),
      'Stable context is not in the contextToChangeset map'
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

    let changesetBuilder = new ChangesetBuilder(
      spriteTree,
      new Set([outerContext, innerContext]),
      new Set([freshlyAddedSprite]),
      new Set([freshlyRemovedSprite]),
      new Map()
    );

    let outerContextChangeset = changesetBuilder.contextToChangeset.get(
      outerContext
    ) as Changeset;
    let innerContextChangeset = changesetBuilder.contextToChangeset.get(
      innerContext
    ) as Changeset;
    assert.ok(
      outerContextChangeset.insertedSprites.size === 0 &&
        outerContextChangeset.removedSprites.size === 0 &&
        outerContextChangeset.keptSprites.size === 1,
      'Only a single kept sprite in outer context'
    );
    assert.ok(
      innerContextChangeset.insertedSprites.size === 0 &&
        innerContextChangeset.removedSprites.size === 0 &&
        innerContextChangeset.keptSprites.size === 0,
      'No sprites in inner context'
    );
    let keptSprite = [...outerContextChangeset.keptSprites][0];
    assert.equal(keptSprite!.id, 'modifier-kept', 'Kept sprite has correct id');
    assert.deepEqual(
      keptSprite?.initialBounds,
      new ContextAwareBounds({
        element: freshlyRemovedNextDOMRect,
        contextElement: new DOMRect(),
        parent: new DOMRect(),
      })
    );
    assert.deepEqual(
      keptSprite?.finalBounds,
      new ContextAwareBounds({
        element: freshlyAddedNextDOMRect,
        contextElement: outerContextNextDOMRect,
        parent: innerContextNextDOMRect,
      })
    );
    assert.deepEqual(
      keptSprite?.counterpart?.initialBounds,
      new ContextAwareBounds({
        element: freshlyRemovedNextDOMRect,
        contextElement: new DOMRect(),
        parent: new DOMRect(),
      })
    );
    assert.deepEqual(
      keptSprite?.counterpart?.finalBounds,
      new ContextAwareBounds({
        element: freshlyAddedNextDOMRect,
        contextElement: outerContextNextDOMRect,
        parent: innerContextNextDOMRect,
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

    let changesetBuilder = new ChangesetBuilder(
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

    let outerContextChangeset = changesetBuilder.contextToChangeset.get(
      outerContext
    ) as Changeset;
    let innerContextChangeset = changesetBuilder.contextToChangeset.get(
      innerContext
    ) as Changeset;
    assert.ok(
      outerContextChangeset.insertedSprites.size === 0 &&
        outerContextChangeset.removedSprites.size === 1 &&
        outerContextChangeset.keptSprites.size === 0,
      'One removed sprite in outer context'
    );
    assert.equal(
      [...outerContextChangeset.removedSprites][0]!.id,
      'modifier-control'
    );
    assert.ok(
      innerContextChangeset.insertedSprites.size === 0 &&
        innerContextChangeset.removedSprites.size === 0 &&
        innerContextChangeset.keptSprites.size === 1,
      'Only a single kept sprite in inner context'
    );
    let keptSprite = [...innerContextChangeset.keptSprites][0];
    assert.equal(keptSprite?.id, 'modifier-kept-from-intermediate');
    assert.deepEqual(
      keptSprite?.initialBounds,
      new ContextAwareBounds({
        element: spriteFromPreviousRenderNextDOMRect,
        contextElement: new DOMRect(),
        parent: new DOMRect(),
      }),
      'kept sprite intiial bounds are ok'
    );
    assert.deepEqual(
      keptSprite?.finalBounds,
      new ContextAwareBounds({
        element: new DOMRect(0, 1, 1, 0),
        contextElement: innerContextNextDOMRect,
        parent: innerContextNextDOMRect,
      }),
      'kept sprite final bounds are ok'
    );
    assert.equal(keptSprite?.counterpart, null, 'counterpart does not exist');
  });
});

import { module, test } from 'qunit';
import SpriteTree, {
  Context,
  SpriteStateTracker,
} from 'animations-experiment/models/sprite-tree';
import { filterToContext } from 'animations-experiment/models/changeset';
import { CopiedCSS } from 'animations-experiment/utils/measurement';
import Sprite from 'animations-experiment/models/sprite';

class MockAnimationContext implements Context {
  id: string | undefined;
  element: HTMLElement;
  isAnimationContext = true;
  isStable = true;

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
  currentBounds?: DOMRect | undefined;
  lastBounds?: DOMRect | undefined;
  isInitialRenderCompleted = false;
  captureSnapshot(
    opts?: { withAnimations: boolean; playAnimations: boolean } | undefined
  ): void {
    throw new Error('Method not implemented.');
  }
  shouldAnimate(): boolean {
    throw new Error('Method not implemented.');
  }
  hasOrphan(sprite: Sprite): boolean {
    throw new Error('Method not implemented.');
  }
  removeOrphan(sprite: Sprite): void {
    throw new Error('Method not implemented.');
  }
  appendOrphan(sprite: Sprite): void {
    throw new Error('Method not implemented.');
  }
  clearOrphans(): void {
    throw new Error('Method not implemented.');
  }
  args = {};

  stable() {
    this.isStable = true;
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
  currentBounds?: DOMRect | undefined;
  lastBounds?: DOMRect | undefined;
  captureSnapshot(
    opts?: { withAnimations: boolean; playAnimations: boolean } | undefined
  ): void {
    throw new Error('Method not implemented.');
  }
  lastComputedStyle: CopiedCSS | undefined;
  currentComputedStyle: CopiedCSS | undefined;
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

module('Unit | Util | filterToContext', function () {
  test('it returns children of the context only, if all child animation contexts are stable', async function (assert) {
    let rootDiv = document.createElement('div');
    let siblingContext = new MockAnimationContext(rootDiv, 'control-root');
    let controlSpriteModifier = new MockSpriteModifier(
      siblingContext.element,
      'control'
    );
    let targetContext = new MockAnimationContext(rootDiv, 'root');
    let thread1 = nestEachInPrevious(targetContext.element, [
      new MockSpriteModifier(null, 'included-1'),
      new MockAnimationContext(null, 'level-2-1').stable(),
      new MockSpriteModifier(null, 'level-3-1'), // not included
    ]);
    let thread2 = nestEachInPrevious(targetContext.element, [
      new MockSpriteModifier(null, 'included-2'),
      new MockAnimationContext(null, 'level-2-2').stable(),
      new MockSpriteModifier(null, 'level-3-2'), // not included
    ]);
    let tree = new SpriteTree();
    let allItems = [
      siblingContext,
      controlSpriteModifier,
      targetContext,
      ...thread1,
      ...thread2,
    ];
    let sprites = [];
    for (let item of allItems) {
      if (item instanceof MockSpriteModifier) {
        tree.addPendingSpriteModifier(item);
        sprites.push(item);
      } else if (item instanceof MockAnimationContext) {
        tree.addPendingAnimationContext(item);
      }
    }

    tree.flushPendingAdditions();

    let descendants = filterToContext(tree, targetContext, new Set(sprites));

    assert.deepEqual([...descendants].map((v) => v.id).sort(), [
      'included-1',
      'included-2',
    ]);
  });

  test('it returns children of unstable descendant contexts too, for depth > 1 < Infinity', async function (assert) {
    let rootDiv = document.createElement('div');

    let siblingContext = new MockAnimationContext(rootDiv, 'control-root');
    let controlSpriteModifier = new MockSpriteModifier(
      siblingContext.element,
      'control'
    );

    let targetContext = new MockAnimationContext(rootDiv, 'root');
    let thread1 = nestEachInPrevious(targetContext.element, [
      new MockSpriteModifier(null, 'included-1'),
      new MockAnimationContext(null, 'level-2-1').unstable(),
      new MockSpriteModifier(null, 'included-2'),
      new MockAnimationContext(null, 'level-4-1').stable(),
      new MockSpriteModifier(null, 'level-5-1'), // not included
    ]);
    let thread2 = nestEachInPrevious(targetContext.element, [
      new MockSpriteModifier(null, 'included-3'),
      new MockAnimationContext(null, 'level-2-2').unstable(),
      new MockSpriteModifier(null, 'included-4'),
      new MockAnimationContext(null, 'level-4-2').unstable(),
      new MockSpriteModifier(null, 'included-5'),
    ]);
    let tree = new SpriteTree();
    let allItems = [
      siblingContext,
      controlSpriteModifier,
      targetContext,
      ...thread1,
      ...thread2,
    ];
    let sprites = [];
    for (let item of allItems) {
      if (item instanceof MockSpriteModifier) {
        tree.addPendingSpriteModifier(item);
        sprites.push(item);
      } else if (item instanceof MockAnimationContext) {
        tree.addPendingAnimationContext(item);
      }
    }

    tree.flushPendingAdditions();

    let descendants = filterToContext(tree, targetContext, new Set(sprites));

    assert.deepEqual([...descendants].map((v) => v.id).sort(), [
      'included-1',
      'included-2',
      'included-3',
      'included-4',
      'included-5',
    ]);
  });

  test('it includes descendant sprites which are stable contexts themselves but not their descendants', async function (assert) {
    let targetContext = new MockAnimationContext(null, 'root');
    let sharedNodeSprite = new MockSpriteModifier(
      targetContext.element,
      'included-1'
    );
    let sharedNodeContext = new MockAnimationContext(
      null,
      'ctx-level-1-1',
      sharedNodeSprite.element
    ).stable();
    let excluded = new MockSpriteModifier(
      sharedNodeContext.element,
      'level-2-1'
    );
    let tree = new SpriteTree();
    let allItems = [
      targetContext,
      sharedNodeSprite,
      sharedNodeContext,
      excluded,
    ];
    let sprites = [];
    for (let item of allItems) {
      if (item instanceof MockSpriteModifier) {
        tree.addPendingSpriteModifier(item);
        sprites.push(item);
      } else {
        tree.addPendingAnimationContext(item);
      }
    }

    tree.flushPendingAdditions();

    let descendants = filterToContext(tree, targetContext, new Set(sprites));

    assert.deepEqual(
      [...descendants].map((v) => v.id),
      ['included-1']
    );
  });
});

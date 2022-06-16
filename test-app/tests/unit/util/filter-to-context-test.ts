import { module, test } from 'qunit';
import SpriteTree, {
  SpriteModel,
} from 'animations-experiment/models/sprite-tree';
import { filterToContext } from 'animations-experiment/services/animations';
import AnimationContextComponent from 'animations-experiment/addon/components/animation-context';
import SpriteModifier from 'animations-experiment/addon/modifiers/sprite';

class MockAnimationContext
  implements Pick<AnimationContextComponent, 'element' | 'isStable'>
{
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
}

class MockSpriteModifier implements SpriteModel {
  element: Element;
  farMatch = false;
  id: string;
  constructor(
    parentEl: Element | null = null,
    id = 'Mock',
    element: Element | null = null
  ) {
    this.element = element ?? document.createElement('div');
    this.id = id;
    if (parentEl) {
      parentEl.appendChild(this.element);
    }
  }
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
    let divsForThread1: [HTMLElement, HTMLElement, HTMLElement] = [
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
    ];
    targetContext.element.appendChild(divsForThread1[0]);
    divsForThread1[0].appendChild(divsForThread1[1]);
    divsForThread1[1].appendChild(divsForThread1[2]);
    let thread1 = [
      new MockSpriteModifier(null, 'level-1-1', divsForThread1[0]),
      new MockAnimationContext(null, 'level-2-1', divsForThread1[1]), // stable
      new MockSpriteModifier(null, 'level-3-1', divsForThread1[2]), // not included
    ];
    let divsForThread2: [HTMLElement, HTMLElement, HTMLElement] = [
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
    ];
    targetContext.element.appendChild(divsForThread2[0]);
    divsForThread2[0].appendChild(divsForThread2[1]);
    divsForThread2[1].appendChild(divsForThread2[2]);
    let thread2 = [
      new MockSpriteModifier(null, 'level-1-2', divsForThread2[0]),
      new MockAnimationContext(null, 'level-2-2', divsForThread2[1]), // stable
      new MockSpriteModifier(null, 'level-3-2', divsForThread2[2]), // not included
    ];
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
      } else {
        tree.addPendingAnimationContext(item);
      }
    }

    tree.flushPendingAdditions();

    let descendants = filterToContext(
      tree,
      targetContext as unknown as AnimationContextComponent,
      new Set(sprites) as unknown as Set<SpriteModifier>
    );

    assert.deepEqual(
      [...descendants].map((v) => v.id),
      ['level-1-1', 'level-1-2']
    );
  });

  test('it returns children of unstable descendant contexts too, for depth > 1 <= Infinity', async function (assert) {
    let rootDiv = document.createElement('div');

    let siblingContext = new MockAnimationContext(rootDiv, 'control-root');
    let controlSpriteModifier = new MockSpriteModifier(
      siblingContext.element,
      'control'
    );

    let targetContext = new MockAnimationContext(rootDiv, 'root');
    let divsForThread1: [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement
    ] = [
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
    ];
    targetContext.element.appendChild(divsForThread1[0]);
    divsForThread1[0].appendChild(divsForThread1[1]);
    divsForThread1[1].appendChild(divsForThread1[2]);
    divsForThread1[2].appendChild(divsForThread1[3]);
    divsForThread1[3].appendChild(divsForThread1[4]);
    let thread1 = [
      new MockSpriteModifier(null, 'level-1-1', divsForThread1[0]),
      new MockAnimationContext(null, 'level-2-1', divsForThread1[1]),
      new MockSpriteModifier(null, 'level-3-1', divsForThread1[2]),
      new MockAnimationContext(null, 'level-4-1', divsForThread1[3]), // stable
      new MockSpriteModifier(null, 'level-5-1', divsForThread1[4]), // not included
    ];
    (thread1[1] as MockAnimationContext).isStable = false;
    let divsForThread2: [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement
    ] = [
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
    ];
    targetContext.element.appendChild(divsForThread2[0]);
    divsForThread2[0].appendChild(divsForThread2[1]);
    divsForThread2[1].appendChild(divsForThread2[2]);
    divsForThread2[2].appendChild(divsForThread2[3]);
    divsForThread2[3].appendChild(divsForThread2[4]);
    let thread2 = [
      new MockSpriteModifier(null, 'level-1-2', divsForThread2[0]),
      new MockAnimationContext(null, 'level-2-2', divsForThread2[1]),
      new MockSpriteModifier(null, 'level-3-2', divsForThread2[2]),
      new MockAnimationContext(null, 'level-4-2', divsForThread2[3]),
      new MockSpriteModifier(null, 'level-5-2', divsForThread2[4]),
    ];
    (thread2[1] as MockAnimationContext).isStable = false;
    (thread2[3] as MockAnimationContext).isStable = false;
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
      } else {
        tree.addPendingAnimationContext(item);
      }
    }

    tree.flushPendingAdditions();

    let descendants = filterToContext(
      tree,
      targetContext as unknown as AnimationContextComponent,
      new Set(sprites) as unknown as Set<SpriteModifier>
    );

    assert.deepEqual(
      [...descendants].map((v) => v.id),
      ['level-1-1', 'level-3-1', 'level-1-2', 'level-3-2', 'level-5-2']
    );
  });

  test('it includes descendant sprites which are stable contexts themselves but not their descendants', async function (assert) {
    let rootDiv = document.createElement('div');

    let siblingContext = new MockAnimationContext(rootDiv, 'control-root');
    let controlSpriteModifier = new MockSpriteModifier(
      siblingContext.element,
      'control'
    );

    let targetContext = new MockAnimationContext(rootDiv, 'root');
    let divsForThread1: [HTMLElement, HTMLElement, HTMLElement] = [
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
    ];
    targetContext.element.appendChild(divsForThread1[0]);
    divsForThread1[0].appendChild(divsForThread1[1]);
    divsForThread1[1].appendChild(divsForThread1[2]);
    let thread1 = [
      new MockSpriteModifier(null, 'level-1-1', divsForThread1[0]),
      new MockAnimationContext(null, 'ctx-level-1-1', divsForThread1[0]), // stable
      new MockSpriteModifier(null, 'level-3-1', divsForThread1[2]), // not included
    ];
    let divsForThread2: [HTMLElement, HTMLElement, HTMLElement] = [
      document.createElement('div'),
      document.createElement('div'),
      document.createElement('div'),
    ];
    targetContext.element.appendChild(divsForThread2[0]);
    divsForThread2[0].appendChild(divsForThread2[1]);
    divsForThread2[1].appendChild(divsForThread2[2]);
    let thread2 = [
      new MockSpriteModifier(null, 'level-1-2', divsForThread2[0]),
      new MockAnimationContext(null, 'ctx-level-1-2', divsForThread2[0]), // stable
      new MockSpriteModifier(null, 'level-3-2', divsForThread2[2]), // not included
    ];
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
      } else {
        tree.addPendingAnimationContext(item);
      }
    }

    tree.flushPendingAdditions();

    let descendants = filterToContext(
      tree,
      targetContext as unknown as AnimationContextComponent,
      new Set(sprites) as unknown as Set<SpriteModifier>
    );

    assert.deepEqual(
      [...descendants].map((v) => v.id),
      ['level-1-1', 'level-1-2']
    );
  });
});

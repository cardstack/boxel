/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { IContext } from '@cardstack/boxel-motion/addon/models/animator';
import {
  AnimationParticipant,
  AnimationParticipantManager,
} from '@cardstack/boxel-motion/models/animation-participant';
import Sprite, {
  type ISpriteModifier,
  type SpriteType,
} from '@cardstack/boxel-motion';
import { module, test } from 'qunit';

function simulateRender(
  manager: AnimationParticipantManager,
  changes: Parameters<AnimationParticipantManager['updateParticipants']>[0],
) {
  changes.removedContexts.forEach((context) => {
    // mocks have this to simulate the destroying state of contexts, where they are unstable
    (context as unknown as { isDestroying: boolean }).isDestroying = true;
    context.element.remove();
  });
  changes.removedSpriteModifiers.forEach((modifier) => {
    modifier.element.remove();
  });
  manager.clearSnapshots();
  manager.snapshotBeforeRender();
  manager.updateParticipants(changes);
  manager.snapshotAfterRender();
  // manager.log();
  return manager.createAnimatorsAndSprites();
}

function fakeAnimation(element: Element, playState = 'running') {
  return {
    playState,
    effect: {
      target: element,
    } as unknown as KeyframeEffect,
    cancel() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).playState = 'idle';
    },
  } as unknown as Animation;
}
function simulateAnimation(sprite: Sprite) {
  sprite.callbacks.onAnimationStart(fakeAnimation(sprite.element));
}

function mockContext(
  element: HTMLElement,
): IContext & { isDestroying: boolean } {
  return {
    // these are important for creating animators
    element,
    isInitialRenderCompleted: false,
    isDestroying: false,
    get isStable() {
      return this.isInitialRenderCompleted && !this.isDestroying;
    },
    // properties below are not used
    id: undefined,
    orphans: new Map(),
    shouldAnimate: function (): boolean {
      throw new Error('Function not implemented.');
    },
    hasOrphan: function (_spriteOrElement: Sprite): boolean {
      throw new Error('Function not implemented.');
    },
    removeOrphan: function (_spriteOrElement: Sprite): void {
      throw new Error('Function not implemented.');
    },
    appendOrphan: function (_spriteOrElement: Sprite): void {
      throw new Error('Function not implemented.');
    },
    clearOrphans: function (): void {
      throw new Error('Function not implemented.');
    },
    args: {
      use: undefined,
      id: undefined,
    },
  };
}

module('Unit | AnimationParticipantManager', function (hooks) {
  let manager: AnimationParticipantManager;
  let rootElement: HTMLElement;
  let rootContext: IContext;
  let createChildElement: () => HTMLElement;

  hooks.beforeEach(function () {
    manager = new AnimationParticipantManager();
    rootElement = document.createElement('div');
    document.body.appendChild(rootElement);
    rootContext = mockContext(rootElement);
    createChildElement = () => {
      let element = document.createElement('div');
      rootElement.appendChild(element);
      return element;
    };
    simulateRender(manager, {
      insertedContexts: new Set([rootContext]),
      removedContexts: new Set(),
      insertedSpriteModifiers: new Set(),
      removedSpriteModifiers: new Set(),
    });

    if (
      manager.DOMRefs.length !== 1 ||
      manager.DOMRefs[0]?.children.length !== 0
    ) {
      throw new Error(
        'Unexpectedly found child DOMRefs at test initialization',
      );
    }
  });
  hooks.afterEach(function () {
    rootElement.remove();
  });

  test('it can create a new AnimationParticipant', function (assert) {
    let insertedModifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    let { sprites, animators } = simulateRender(manager, {
      insertedSpriteModifiers: new Set([insertedModifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });

    assert.equal(animators.length, 1);
    assert.equal(sprites.length, 1);

    let sprite = sprites[0]!;
    assert.equal(sprite.type, SpriteType.Inserted);
    assert.equal(sprite.defaultAnimator, animators[0]);
  });

  test('it can update an AnimationParticipant with removals', function (assert) {
    let modifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };

    simulateRender(manager, {
      insertedSpriteModifiers: new Set([modifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });
    let { sprites, animators } = simulateRender(manager, {
      insertedSpriteModifiers: new Set(),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set([modifier]),
    });

    assert.equal(animators.length, 1);
    assert.equal(sprites.length, 1);

    let sprite = sprites[0]!;
    assert.equal(sprite.type, SpriteType.Removed);
    assert.equal(sprite.defaultAnimator, animators[0]);
  });
  test('it can update an AnimationParticipant with insertions', async function (assert) {
    let modifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    simulateRender(manager, {
      insertedSpriteModifiers: new Set([modifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });
    let { sprites: removed } = simulateRender(manager, {
      insertedSpriteModifiers: new Set(),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set([modifier]),
    });

    assert.equal(removed.length, 1);
    simulateAnimation(removed[0]!);

    let matchedInsertedModifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    let { animators, sprites } = simulateRender(manager, {
      insertedSpriteModifiers: new Set([matchedInsertedModifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });

    assert.equal(animators.length, 1);
    assert.equal(sprites.length, 1);

    let sprite = sprites[0]!;
    assert.equal(sprite.type, SpriteType.Kept);
    assert.ok(sprite.counterpart);
    assert.equal(sprite.defaultAnimator, animators[0]);
  });

  test('it can update an AnimationParticipant with matching insertions and removals', function (assert) {
    let modifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    simulateRender(manager, {
      insertedSpriteModifiers: new Set([modifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });

    let matchedInsertedModifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    let { animators, sprites } = simulateRender(manager, {
      insertedSpriteModifiers: new Set([matchedInsertedModifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set([modifier]),
    });

    assert.equal(animators.length, 1);
    assert.equal(sprites.length, 1);

    let sprite = sprites[0]!;
    assert.equal(sprite.type, SpriteType.Kept);
    assert.ok(sprite.counterpart);
    assert.equal(sprite.defaultAnimator, animators[0]);
  });
  test('it can update an AnimationParticipant with a matching inserted context', function (assert) {
    let modifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };

    simulateRender(manager, {
      insertedSpriteModifiers: new Set([modifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });
    let { sprites: removed } = simulateRender(manager, {
      insertedSpriteModifiers: new Set(),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set([modifier]),
    });
    assert.equal(removed.length, 1);
    simulateAnimation(removed[0]!);

    let element = createChildElement();
    let matchedInsertedContext = mockContext(element);
    let matchedInsertedModifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element,
    };
    let { sprites, animators } = simulateRender(manager, {
      insertedSpriteModifiers: new Set([matchedInsertedModifier]),
      insertedContexts: new Set([matchedInsertedContext]),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });

    assert.equal(animators.length, 1);
    assert.equal(sprites.length, 1);

    let sprite = sprites[0]!;
    assert.equal(sprite.type, SpriteType.Kept);
    assert.ok(sprite.counterpart);
    assert.equal(sprite.defaultAnimator, animators[0]);
  });

  test('it provides sprites with the correct defaultAnimator', function (assert) {
    // ──┬ 🥡:root
    //   └─┬ 🥠:sprite-1
    //     └─┬ 🥡:context2
    //       └── 🥠:sprite-2
    let sprite1Element = document.createElement('div');
    let context2Element = document.createElement('div');
    let sprite2Element = document.createElement('div');
    rootElement.appendChild(sprite1Element);
    sprite1Element.appendChild(context2Element);
    context2Element.appendChild(sprite2Element);

    simulateRender(manager, {
      insertedContexts: new Set([mockContext(context2Element)]),
      insertedSpriteModifiers: new Set([
        {
          element: sprite1Element,
          id: 'sprite-1',
          role: '',
        },
        {
          element: sprite2Element,
          id: 'sprite-2',
          role: '',
        },
      ]),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });

    let { sprites, animators } = simulateRender(manager, {
      insertedContexts: new Set(),
      removedContexts: new Set(),
      insertedSpriteModifiers: new Set(),
      removedSpriteModifiers: new Set(),
    });

    let rootContextAnimator = animators.find(
      (a) => a.context.element === rootElement,
    );
    let context2Animator = animators.find(
      (a) => a.context.element === context2Element,
    );
    let sprite1 = sprites.find((s) => s.id === 'sprite-1');
    let sprite2 = sprites.find((s) => s.id === 'sprite-2');

    assert.ok(rootContextAnimator);
    assert.ok(context2Animator);
    assert.equal(sprite1?.defaultAnimator, rootContextAnimator);
    assert.equal(sprite2?.defaultAnimator, context2Animator);
  });

  test('it can perform cleanup of disposed DOMRefs', function (assert) {
    let modifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    simulateRender(manager, {
      insertedSpriteModifiers: new Set([modifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set(),
    });

    let matchedInsertedModifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    let { sprites: removed } = simulateRender(manager, {
      insertedSpriteModifiers: new Set([matchedInsertedModifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set([modifier]),
    });
    let counterpart = removed[0]!.counterpart!;
    simulateAnimation(counterpart);

    let latestModifier: ISpriteModifier = {
      id: 'id',
      role: 'role',
      element: createChildElement(),
    };
    simulateRender(manager, {
      insertedSpriteModifiers: new Set([latestModifier]),
      insertedContexts: new Set(),
      removedContexts: new Set(),
      removedSpriteModifiers: new Set([matchedInsertedModifier]),
    });

    let modifierParticipant!: AnimationParticipant;
    manager.participants.forEach((p) => {
      if (p.latestModifier === latestModifier) {
        modifierParticipant = p;
      }
    });

    assert.ok(modifierParticipant);
    assert.equal(modifierParticipant._DOMRefsToDispose.size, 1);
    assert.equal(manager.DOMRefs.length, 1);
    assert.equal(manager.DOMRefs[0]!.children.length, 3);

    manager.performCleanup();

    assert.equal(modifierParticipant._DOMRefsToDispose.size, 0);
    assert.equal(manager.DOMRefs[0]!.children.length, 1);
  });

  module('removal of detached things', function (hooks) {
    let modifierParticipant: AnimationParticipant;
    let element: Element;
    hooks.beforeEach(function () {
      element = createChildElement();
      let modifier: ISpriteModifier = {
        id: 'id',
        role: 'role',
        element,
      };
      simulateRender(manager, {
        insertedSpriteModifiers: new Set([modifier]),
        insertedContexts: new Set(),
        removedContexts: new Set(),
        removedSpriteModifiers: new Set(),
      });
      simulateRender(manager, {
        insertedSpriteModifiers: new Set(),
        insertedContexts: new Set(),
        removedContexts: new Set(),
        removedSpriteModifiers: new Set([modifier]),
      });

      manager.participants.forEach((p) => {
        if (p.latestModifier === modifier) {
          modifierParticipant = p;
        }
      });
    });

    test('it can perform cleanup of unused detached uiState', function (assert) {
      assert.ok(modifierParticipant);
      assert.equal(modifierParticipant.uiState.detached!.animation, undefined);

      manager.performCleanup();

      assert.equal(modifierParticipant.uiState.detached, undefined);
    });

    test('it can perform cleanup of unused detached uiState with a finished animation', function (assert) {
      assert.ok(modifierParticipant);
      modifierParticipant.uiState.detached!.animation = fakeAnimation(
        element,
        'finished',
      );
      assert.equal(
        modifierParticipant.uiState.detached!.animation.playState,
        'finished',
      );

      manager.performCleanup();

      assert.equal(modifierParticipant.uiState.detached, undefined);
    });

    test('it does not remove detached DOMRefs that are animated', function (assert) {
      assert.ok(modifierParticipant);
      modifierParticipant.uiState.detached!.animation = fakeAnimation(element);
      assert.equal(
        modifierParticipant.uiState.detached!.animation.playState,
        'running',
      );

      manager.performCleanup();

      assert.ok(modifierParticipant.uiState.detached);
    });

    // TODO: if we implement cloning, revisit
    // test('it prunes and grafts detached nodes that are animated', function (assert) {});
  });
});

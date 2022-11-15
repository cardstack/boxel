/* eslint-disable @typescript-eslint/no-empty-function */
import {
  AnimationParticipant,
  AnimationParticipantIdentifier,
} from '@cardstack/boxel-motion/models/animation-participant';
import { Changeset, IContext } from '@cardstack/boxel-motion/models/animator';
import { DOMRefNode } from '@cardstack/boxel-motion/models/dom-ref';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import sprite, { SpriteType } from '@cardstack/boxel-motion/models/sprite';
import { module, test, todo } from 'qunit';

class TestContext implements IContext {
  id: string | undefined;
  element: Element;
  isInitialRenderCompleted: boolean;
  isStable: boolean;
  orphans: Map<string, HTMLElement>;
  shouldAnimate(): boolean {
    throw new Error('Method not implemented.');
  }
  hasOrphan(spriteOrElement: sprite): boolean {
    throw new Error('Method not implemented.');
  }
  removeOrphan(spriteOrElement: sprite): void {
    throw new Error('Method not implemented.');
  }
  appendOrphan(spriteOrElement: sprite): void {
    throw new Error('Method not implemented.');
  }
  clearOrphans(): void {
    throw new Error('Method not implemented.');
  }
  args: {
    use?(changeset: Changeset): AnimationDefinition;
    id?: string | undefined;
  };

  constructor(options: { id?: string; element: Element; isStable: boolean }) {
    this.id = options.id;
    this.element = options.element;
    this.isStable = options.isStable;

    this.isInitialRenderCompleted = false;
    this.orphans = new Map();
    this.args = {};
  }
}

module('Unit | AnimationParticipant', function () {
  // Initialization
  test('it can be initialized with a sprite and a context', function (assert) {
    let element = document.createElement('div');
    let domRefNode = new DOMRefNode(element);

    let context = new TestContext({ element, isStable: true });
    let identifier = new AnimationParticipantIdentifier('modifier-id', element);

    let participant = new AnimationParticipant({
      context,
      spriteModifier: {
        id: 'modifier-id',
        role: null,
        element,
      },
      DOMRef: domRefNode,
      identifier,
    });

    assert.equal(participant.context, context);
    assert.equal(participant.identifier, identifier);

    let currentState = participant.uiState.current;

    assert.equal(currentState?._stage, 'BEFORE_RENDER');
    assert.notOk(currentState?.beforeRender);
    assert.notOk(currentState?.afterRender);
    assert.notOk(currentState?.animation);
    assert.equal(currentState?.DOMRef, domRefNode);
  });

  // Capturing state
  todo('it can cancel its animations', function () {});
  todo('it can clear its snapshots', function () {});
  todo('it can remove animations that are no longer running', function () {});
  todo(
    'it can capture beforeRender snapshots of unanimated existing elements',
    function () {}
  );
  todo(
    'it can capture beforeRender snapshots of animated removed elements',
    function () {}
  );
  todo(
    'it can capture beforeRender snapshots of animated existing elements',
    function () {}
  );
  todo(
    'it can capture afterRender snapshots of the final state of an existing element',
    function () {}
  );

  // cleanup conditions
  todo(
    'it is ready for cleanup if it is only tracking an unanimated detached element',
    function () {}
  );
  todo(
    'it is ready for cleanup if it has no context or sprite modifier',
    function () {}
  );

  // methods to set current and detached
  todo(
    'it can create a new uiState.current with a BEFORE_RENDER state',
    function () {}
  );
  todo('it can change uiState.current to uiState.detached', function () {
    // assert that the animation is NOT carried over <-- important. because the current setup for animation tracking will try to clear current.animation when the animation is over, but not detached.animation
    // assert that afterRender is NOT carried over
    // assert that beforeRender IS carried over
    // assert that DOMRef IS carried over
  });
  todo(
    'it marks existing detached DOMRef for disposal when changing uiState.current to uiState.detached',
    function () {}
  );

  // Handling matches
  module('context-only participant, removal', function () {
    // context-only participant, removal. insertion should not matter for a context-only participant (no way to match contexts)
    todo('it removes a context and is ready for cleanup', function () {});
    todo(
      'it removes a context and updates its identifier element to null',
      function () {}
    );
  });
  module('detached only', function () {
    todo('it can handle an inserted sprite modifier', function () {});
    todo(
      'it can handle an inserted sprite modifier that is also a context',
      function () {}
    );
  });
  module('current only', function () {
    todo(
      'it can handle simultaneous matched inserted and removed sprite modifier',
      function () {}
    );
    todo(
      'it can handle simultaneous matched inserted and removed sprite modifiers that are also contexts',
      function () {}
    );
    todo('it can handle an removed sprite modifier', function () {});
    todo(
      'it can handle an removed sprite modifier that is also a context',
      function () {}
    );
  });
  module('current and detached', function () {
    todo(
      'it can handle simultaneous matched inserted and removed sprite modifier',
      function () {}
    );
    todo(
      'it can handle simultaneous matched inserted and removed sprite modifier that are also contexts',
      function () {}
    );
    todo('it can handle a removed sprite modifier', function () {});
    todo(
      'it can handle a removed sprite modifier that is also a context',
      function () {}
    );
  });

  // Output
  test('it can create an Animator', function (assert) {
    let element = document.createElement('div');
    let domRefNode = new DOMRefNode(element);

    let context = new TestContext({ element, isStable: true });
    let identifier = new AnimationParticipantIdentifier('modifier-id', element);

    let participant = new AnimationParticipant({
      context,
      spriteModifier: {
        id: 'modifier-id',
        role: null,
        element,
      },
      DOMRef: domRefNode,
      identifier,
    });

    participant.snapshotAfterRender();
    participant.clearSnapshots();
    participant.snapshotBeforeRender();
    participant.snapshotAfterRender();

    let animator = participant.asAnimator();

    assert.equal(
      participant.uiState.current?.beforeRender,
      animator?._state.initial
    );

    assert.equal(
      participant.uiState?.current?.afterRender,
      animator?._state.final
    );
  });

  test('it returns null when it cannot create an Animator because it has no context', function (assert) {
    let element = document.createElement('div');
    let domRefNode = new DOMRefNode(element);

    let identifier = new AnimationParticipantIdentifier('modifier-id', element);

    let participant = new AnimationParticipant({
      spriteModifier: {
        id: 'modifier-id',
        role: null,
        element,
      },
      DOMRef: domRefNode,
      identifier,
    });

    participant.snapshotAfterRender();
    participant.clearSnapshots();
    participant.snapshotBeforeRender();
    participant.snapshotAfterRender();

    let animator = participant.asAnimator();

    assert.notOk(animator);
  });

  test('it returns null when it cannot create an Animator because its context is not stable', function (assert) {
    let element = document.createElement('div');
    let domRefNode = new DOMRefNode(element);

    let context = new TestContext({ element, isStable: false });
    let identifier = new AnimationParticipantIdentifier('modifier-id', element);

    let participant = new AnimationParticipant({
      context,
      spriteModifier: {
        id: 'modifier-id',
        role: null,
        element,
      },
      DOMRef: domRefNode,
      identifier,
    });

    participant.snapshotAfterRender();
    participant.clearSnapshots();
    participant.snapshotBeforeRender();
    participant.snapshotAfterRender();

    let animator = participant.asAnimator();

    assert.notOk(animator);
  });

  test('it can create a Kept sprite', function (assert) {
    let element = document.createElement('div');
    let domRefNode = new DOMRefNode(element);

    let context = new TestContext({ element, isStable: false });
    let identifier = new AnimationParticipantIdentifier('modifier-id', element);

    let participant = new AnimationParticipant({
      context,
      spriteModifier: {
        id: 'modifier-id',
        role: null,
        element,
      },
      DOMRef: domRefNode,
      identifier,
    });

    participant.snapshotAfterRender();
    participant.clearSnapshots();
    participant.snapshotBeforeRender();
    participant.snapshotAfterRender();

    let sprite = participant.asSprite();

    assert.equal(sprite?.type, SpriteType.Kept);

    assert.equal(
      participant.uiState.current?.beforeRender,
      sprite?._state.initial
    );

    assert.equal(
      participant.uiState?.current?.afterRender,
      sprite?._state.final
    );
  });
  todo(
    'Kept sprite and counterpart animation callback updates appropriate uiState',
    function () {}
  );

  todo('it can create a Kept sprite with a counterpart', function () {});
  todo(
    'Kept sprite animation callback updates appropriate uiState',
    function () {}
  );

  test('it can create a Removed sprite', function (assert) {
    let element = document.createElement('div');
    let domRefNode = new DOMRefNode(element);

    let context = new TestContext({ element, isStable: false });
    let identifier = new AnimationParticipantIdentifier('modifier-id', element);

    let spriteModifier = {
      id: 'modifier-id',
      role: null,
      element,
    };

    let participant = new AnimationParticipant({
      context,
      spriteModifier,
      DOMRef: domRefNode,
      identifier,
    });

    participant.snapshotAfterRender();
    participant.clearSnapshots();
    participant.snapshotBeforeRender();
    participant.handleMatches({ removedSpriteModifier: spriteModifier });
    participant.snapshotAfterRender();

    let sprite = participant.asSprite();

    assert.equal(sprite?.type, SpriteType.Removed);

    assert.equal(
      participant.uiState.detached?.beforeRender,
      sprite?._state.initial
    );

    assert.notOk(sprite?._state.final);
  });
  todo(
    'Removed sprite animation callback updates appropriate uiState',
    function () {}
  );

  todo('it can create a Inserted sprite', function () {});
  todo(
    'Inserted sprite animation callback updates appropriate uiState',
    function () {}
  );

  test('it returns null when it cannot create a sprite', function (assert) {
    let element = document.createElement('div');
    let domRefNode = new DOMRefNode(element);

    let context = new TestContext({ element, isStable: true });
    let identifier = new AnimationParticipantIdentifier('modifier-id', element);

    let participant = new AnimationParticipant({
      context,
      DOMRef: domRefNode,
      identifier,
    });

    participant.snapshotAfterRender();
    participant.clearSnapshots();
    participant.snapshotBeforeRender();
    participant.snapshotAfterRender();

    assert.notOk(participant.asSprite());
  });
});

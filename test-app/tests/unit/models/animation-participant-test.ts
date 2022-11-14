/* eslint-disable @typescript-eslint/no-empty-function */
// import { AnimationParticipant } from '@cardstack/boxel-motion/models/animation-participant';
import { module, test } from 'qunit';

module.skip('Unit | AnimationParticipant', function () {
  // Initialization
  test('it can be initialized with a context only', function () {});
  test('it can be initialized with a sprite only', function () {});
  test('it can be initialized with a sprite and a context', function () {});

  // Capturing state
  test('it can cancel its animations', function () {});
  test('it can clear its snapshots', function () {});
  test('it can remove animations that are no longer running', function () {});
  test('it can capture beforeRender snapshots of unanimated existing elements', function () {});
  test('it can capture beforeRender snapshots of animated removed elements', function () {});
  test('it can capture beforeRender snapshots of animated existing elements', function () {});
  test('it can capture afterRender snapshots of the final state of an existing element', function () {});

  // cleanup conditions
  test('it is ready for cleanup if it is only tracking an unanimated detached element', function () {});
  test('it is ready for cleanup if it has no context or sprite modifier', function () {});

  // methods to set current and detached
  test('it can create a new uiState.current with a BEFORE_RENDER state', function () {});
  test('it can change uiState.current to uiState.detached', function () {
    // assert that the animation is NOT carried over <-- important. because the current setup for animation tracking will try to clear current.animation when the animation is over, but not detached.animation
    // assert that afterRender is NOT carried over
    // assert that beforeRender IS carried over
    // assert that DOMRef IS carried over
  });
  test('it marks existing detached DOMRef for disposal when changing uiState.current to uiState.detached', function () {});

  // Handling matches
  module('context-only participant, removal', function () {
    // context-only participant, removal. insertion should not matter for a context-only participant (no way to match contexts)
    test('it removes a context and is ready for cleanup', function () {});
    test('it removes a context and updates its identifier element to null', function () {});
  });
  module('detached only', function () {
    test('it can handle an inserted sprite modifier', function () {});
    test('it can handle an inserted sprite modifier that is also a context', function () {});
  });
  module('current only', function () {
    test('it can handle simultaneous matched inserted and removed sprite modifier', function () {});
    test('it can handle simultaneous matched inserted and removed sprite modifiers that are also contexts', function () {});
    test('it can handle an removed sprite modifier', function () {});
    test('it can handle an removed sprite modifier that is also a context', function () {});
  });
  module('current and detached', function () {
    test('it can handle simultaneous matched inserted and removed sprite modifier', function () {});
    test('it can handle simultaneous matched inserted and removed sprite modifier that are also contexts', function () {});
    test('it can handle a removed sprite modifier', function () {});
    test('it can handle a removed sprite modifier that is also a context', function () {});
  });

  // Output
  test('it can create an Animator', function () {});
  test('it returns null when it cannot create an Animator', function () {});

  test('it can create a Kept sprite with a counterpart', function () {});
  test('Kept sprite and counterpart animation callback updates appropriate uiState', function () {});

  test('it can create a Kept sprite', function () {});
  test('Kept sprite animation callback updates appropriate uiState', function () {});

  test('it can create a Removed sprite', function () {});
  test('Removed sprite animation callback updates appropriate uiState', function () {});

  test('it can create a Inserted sprite', function () {});
  test('Inserted sprite animation callback updates appropriate uiState', function () {});

  test('it returns null when it cannot create a sprite', function () {});
});

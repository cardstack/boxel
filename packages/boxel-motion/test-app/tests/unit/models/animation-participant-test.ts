/* eslint-disable @typescript-eslint/no-empty-function */
// import { AnimationParticipant } from '@cardstack/boxel-motion/models';
import { module, skip } from 'qunit';

module.skip('Unit | AnimationParticipant', function () {
  // Initialization
  skip('it can be initialized with a context only', function () {});
  skip('it can be initialized with a sprite only', function () {});
  skip('it can be initialized with a sprite and a context', function () {});

  // Capturing state
  skip('it can cancel its animations', function () {});
  skip('it can clear its snapshots', function () {});
  skip('it can remove animations that are no longer running', function () {});
  skip('it can capture beforeRender snapshots of unanimated existing elements', function () {});
  skip('it can capture beforeRender snapshots of animated removed elements', function () {});
  skip('it can capture beforeRender snapshots of animated existing elements', function () {});
  skip('it can capture afterRender snapshots of the final state of an existing element', function () {});

  // cleanup conditions
  skip('it is ready for cleanup if it is only tracking an unanimated detached element', function () {});
  skip('it is ready for cleanup if it has no context or sprite modifier', function () {});

  // methods to set current and detached
  skip('it can create a new uiState.current with a BEFORE_RENDER state', function () {});
  skip('it can change uiState.current to uiState.detached', function () {
    // assert that the animation is NOT carried over <-- important. because the current setup for animation tracking will try to clear current.animation when the animation is over, but not detached.animation
    // assert that afterRender is NOT carried over
    // assert that beforeRender IS carried over
    // assert that DOMRef IS carried over
  });
  skip('it marks existing detached DOMRef for disposal when changing uiState.current to uiState.detached', function () {});

  // Handling matches
  module('context-only participant, removal', function () {
    // context-only participant, removal. insertion should not matter for a context-only participant (no way to match contexts)
    skip('it removes a context and is ready for cleanup', function () {});
    skip('it removes a context and updates its identifier element to null', function () {});
  });
  module('detached only', function () {
    skip('it can handle an inserted sprite modifier', function () {});
    skip('it can handle an inserted sprite modifier that is also a context', function () {});
  });
  module('current only', function () {
    skip('it can handle simultaneous matched inserted and removed sprite modifier', function () {});
    skip('it can handle simultaneous matched inserted and removed sprite modifiers that are also contexts', function () {});
    skip('it can handle an removed sprite modifier', function () {});
    skip('it can handle an removed sprite modifier that is also a context', function () {});
  });
  module('current and detached', function () {
    skip('it can handle simultaneous matched inserted and removed sprite modifier', function () {});
    skip('it can handle simultaneous matched inserted and removed sprite modifier that are also contexts', function () {});
    skip('it can handle a removed sprite modifier', function () {});
    skip('it can handle a removed sprite modifier that is also a context', function () {});
  });

  // Output
  skip('it can create an Animator', function () {});
  skip('it returns null when it cannot create an Animator', function () {});

  skip('it can create a Kept sprite with a counterpart', function () {});
  skip('Kept sprite and counterpart animation callback updates appropriate uiState', function () {});

  skip('it can create a Kept sprite', function () {});
  skip('Kept sprite animation callback updates appropriate uiState', function () {});

  skip('it can create a Removed sprite', function () {});
  skip('Removed sprite animation callback updates appropriate uiState', function () {});

  skip('it can create a Inserted sprite', function () {});
  skip('Inserted sprite animation callback updates appropriate uiState', function () {});

  skip('it returns null when it cannot create a sprite', function () {});
});

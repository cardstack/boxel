'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    // <style> is allowed, as in boxel's own template-lint plugin: the film
    // components carry their stylesheet with them.
    'no-forbidden-elements': ['meta', 'html', 'script'],
    // Choreo's overlay layers carry static structural styles (absolute overlay
    // positioning) on the element, so they work without the consumer importing
    // any CSS, and the film components bind each clip's computed placement and
    // look. CSS the engine animates goes through the motion modifier.
    'no-inline-styles': false,
    // The film player's scrub starts on pointer down; binding it to pointer up
    // would break the gesture.
    'no-pointer-down-event-binding': false,
  },
  overrides: [
    {
      // Test fixtures bind gestures to plain elements, start drags on
      // pointer down as the engine does, and set exact geometry with computed
      // inline styles so measurements are deterministic. The leading ** also
      // matches the absolute paths the pre-commit autofix passes.
      files: ['**/tests/**'],
      rules: {
        'no-invalid-interactive': false,
        'style-concatenation': false,
      },
    },
  ],
};

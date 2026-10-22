'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    // <style> is allowed, as in boxel's own template-lint plugin.
    'no-forbidden-elements': ['meta', 'html', 'script'],
    // Only a <details> element's <summary> is interactive, so buttons in its
    // open panel are not nested controls.
    'no-nested-interactive': { ignoredTags: ['details'] },
    // A drag, press or scrub gesture starts on pointer down; binding it to
    // pointer up would break the gesture.
    'no-pointer-down-event-binding': false,
  },
  overrides: [
    {
      // Test fixtures set exact geometry inline so the engine's measurements
      // are deterministic, and bind gestures to plain elements to exercise
      // the engine directly. The leading ** also matches the absolute paths
      // the pre-commit autofix passes.
      files: ['**/tests/**'],
      rules: {
        'no-inline-styles': false,
        'no-invalid-interactive': false,
        'style-concatenation': false,
      },
    },
  ],
};

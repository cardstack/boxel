'use strict';

module.exports = {
  extends: ['recommended', '@cardstack/template-lint:recommended'],
  plugins: ['../template-lint/plugin'],
  rules: {
    // Only a <details> element's <summary> is interactive, so buttons in its
    // open panel are not nested controls.
    'no-nested-interactive': { ignoredTags: ['details'] },
    // A drag, press or scrub gesture starts on pointer down; binding it to
    // pointer up would break the gesture.
    'no-pointer-down-event-binding': false,
  },
};

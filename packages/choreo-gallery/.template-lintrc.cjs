'use strict';

module.exports = {
  extends: ['recommended', '@cardstack/template-lint:recommended'],
  plugins: ['../template-lint/plugin'],
  rules: {
    // A drag, press or scrub gesture starts on pointer down; binding it to
    // pointer up would break the gesture.
    'no-pointer-down-event-binding': false,
  },
};

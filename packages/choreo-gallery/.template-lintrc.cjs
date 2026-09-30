'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    // <style> is allowed, as in boxel's own template-lint plugin.
    'no-forbidden-elements': ['meta', 'html', 'script'],
    // A drag, press or scrub gesture starts on pointer down; binding it to
    // pointer up would break the gesture.
    'no-pointer-down-event-binding': false,
  },
};

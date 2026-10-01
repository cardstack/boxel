'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    // <style> is allowed, as in boxel's own template-lint plugin: the film
    // components carry their stylesheet with them.
    'no-forbidden-elements': ['meta', 'html', 'script'],
    // The layout wrappers (Choreo's overlay layers, LayoutGroup, MotionConfig,
    // the film graph host) carry static structural styles — display:
    // contents, absolute overlay positioning — on the element, so they work
    // without the consumer importing any CSS. CSS the engine animates goes
    // through the motion modifier, never a bound style attribute.
    'no-inline-styles': false,
    // A drag, press or scrub gesture starts on pointer down; binding it to
    // pointer up would break the gesture.
    'no-pointer-down-event-binding': false,
  },
};

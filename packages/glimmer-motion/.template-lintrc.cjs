'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    // <style> is allowed, as in boxel's own template-lint plugin: the film
    // components carry their stylesheet with them.
    'no-forbidden-elements': ['meta', 'html', 'script'],
    // The addon ships no stylesheet, so the structural styles its own
    // elements need (display: contents, overlay positioning) ride on the
    // element. CSS the engine animates goes through the motion modifier,
    // never a bound style attribute.
    'no-inline-styles': false,
    // A drag, press or scrub gesture starts on pointer down; binding it to
    // pointer up would break the gesture.
    'no-pointer-down-event-binding': false,
  },
};

'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    // The layout wrappers (LayoutGroup, MotionConfig) carry a static
    // `display: contents` on the element, so they work without the consumer
    // importing any CSS. CSS the engine animates goes through the motion
    // modifier, never a bound style attribute.
    'no-inline-styles': false,
  },
};

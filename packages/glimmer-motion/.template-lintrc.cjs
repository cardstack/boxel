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
  overrides: [
    {
      // Test fixtures bind gestures to plain elements to exercise the engine
      // directly, start drag and press gestures on pointer down as the engine
      // does, and set exact geometry with <style> blocks and computed inline
      // styles so the engine's measurements are deterministic. The leading
      // ** also matches the absolute paths the pre-commit autofix passes.
      files: ['**/tests/**'],
      rules: {
        'no-forbidden-elements': ['meta', 'html', 'script'],
        'no-invalid-interactive': false,
        'no-pointer-down-event-binding': false,
        'style-concatenation': false,
      },
    },
  ],
};

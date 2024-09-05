'use strict';

module.exports = {
  extends: ['recommended', '@cardstack/template-lint:recommended'],
  plugins: ['../../template-lint/plugin'],
  rules: {
    'require-button-type': false,
    'no-pointer-down-event-binding': false,
  },
  overrides: [
    {
      files: ['**/*.gjs', '**/*.gts'],
      rules: {
        // This is the default without style, as we use glimmer-scoped-css
        'no-forbidden-elements': ['meta', 'html', 'script'],
        'no-positive-tabindex': false,
      },
    },
  ],
};

'use strict';

module.exports = {
  extends: ['recommended', '@cardstack/template-lint:recommended'],
  plugins: ['../../template-lint/plugin'],
  rules: {
    'no-pointer-down-event-binding': false,
    'no-positive-tabindex': false,
  },
  overrides: [
    {
      files: ['src/icons/**.gts'],
      rules: {
        'no-inline-styles': false,
      },
    },
  ],
};

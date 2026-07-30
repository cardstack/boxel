'use strict';

module.exports = {
  extends: ['recommended', '@cardstack/template-lint:recommended'],
  // the nested docs app is its own package with its own config
  ignore: ['docs-app/**'],
  plugins: ['../template-lint/plugin'],
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

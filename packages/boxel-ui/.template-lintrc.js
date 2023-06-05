'use strict';

module.exports = {
  extends: 'recommended',
  rules: {
    'require-button-type': false,
  },
  overrides: [
    {
      files: ['**/*.gjs', '**/*.gts'],
      rules: {
        'no-forbidden-elements': ['meta', 'html', 'script'],
      },
    },
  ],
};

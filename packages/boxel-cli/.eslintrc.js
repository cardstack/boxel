'use strict';

module.exports = {
  overrides: [
    {
      files: ['./.eslintrc.js', './bin/*.js'],
      parserOptions: {
        sourceType: 'script',
      },
      env: {
        browser: false,
        node: true,
      },
      extends: ['plugin:n/recommended'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};

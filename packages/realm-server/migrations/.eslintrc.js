'use strict';

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
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
    camelcase: 'off',
  },
};

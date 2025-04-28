'use strict';

module.exports = {
  root: true,
  reportUnusedDisableDirectives: true,
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
    camelcase: 'off',
  },
};

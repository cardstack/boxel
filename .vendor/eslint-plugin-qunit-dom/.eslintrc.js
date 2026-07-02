'use strict';

module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: '2019',
  },
  plugins: ['eslint-plugin', 'filenames', 'import', 'jest', 'node', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:eslint-comments/recommended',
    'plugin:eslint-plugin/all',
    'plugin:jest/recommended',
    'plugin:jest/style',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:node/recommended',
    'prettier',
  ],
  env: {
    node: true,
  },
  rules: {
    'prettier/prettier': 'error',
  },
  overrides: [
    {
      // Test files:
      files: ['tests/**/*.js'],
      env: { jest: true },
    },
  ],
};

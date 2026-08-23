'use strict';

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    warnOnUnsupportedTypeScriptVersion: false,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  env: { browser: true },
  rules: {
    'no-undef': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      files: ['**/*.gts'],
      parser: 'ember-eslint-parser',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
        warnOnUnsupportedTypeScriptVersion: false,
      },
      plugins: ['ember', '@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:ember/recommended',
        'plugin:ember/recommended-gts',
        'plugin:prettier/recommended',
      ],
      rules: {
        'no-undef': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};

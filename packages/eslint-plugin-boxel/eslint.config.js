'use strict';

module.exports = [
  // Always start with ignores to ensure they take priority
  {
    ignores: [
      '**/node_modules/**',
      'coverage/**',
      'dist/**',
      'tmp/**',
      'compiled/**',
      // Type-aware rule fixtures: these are inputs to a TypeScript program the
      // rule tester builds, not sources this package compiles or ships.
      'tests/lib/rules/fixtures/**',
    ],
  },

  // For regular JavaScript and TypeScript files
  {
    files: ['**/*.js', '**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
  },

  // Special handling for module files
  {
    files: ['**/*.mjs', '**/*.esm.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },

  // Rule test files need special handling for templates
  {
    files: ['tests/lib/rules/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: require('ember-eslint-parser'),
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
  },
];

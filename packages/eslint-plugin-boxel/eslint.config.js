'use strict';

const path = require('path');
const eslintPluginImport = require('eslint-plugin-import');

module.exports = [
  // Always start with ignores to ensure they take priority
  {
    ignores: [
      '**/node_modules/**',
      'coverage/**',
      'dist/**',
      'tmp/**',
      'compiled/**',
    ],
  },

  // For regular JavaScript and TypeScript files
  {
    files: ['**/*.js', '**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
    },
    plugins: {
      import: eslintPluginImport,
    },
    rules: {
      // Add eslint-plugin-import rules
      'import/extensions': 'off', // Turn off for now to avoid the errors
      'import/no-dynamic-require': 'off', // Turn off for now to avoid the errors
      'import/no-unresolved': 'off', // Helps with workspace dependencies
    },
  },

  // Special handling for module files
  {
    files: ['**/*.mjs', '**/*.esm.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      import: eslintPluginImport,
    },
    rules: {
      'import/extensions': 'off',
      'import/no-dynamic-require': 'off',
      'import/no-unresolved': 'off',
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
    plugins: {
      import: eslintPluginImport,
    },
    rules: {
      'import/extensions': 'off',
      'import/no-dynamic-require': 'off',
      'import/no-unresolved': 'off',
    },
  },
];

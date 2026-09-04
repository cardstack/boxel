'use strict';

const {
  AMBIENT_CLOCK_SELECTORS,
} = require('../../eslint/ambient-clock-selectors.cjs');

// Deliberately narrow: this package's ESLint run exists to enforce the clock
// seam and nothing else.
//
// `root: true` with no `extends` means no rule is on unless it is listed here.
// Card source in this package has never been ESLint-linted, so switching on a
// recommended set would surface a backlog unrelated to the clock and make this
// guard wait behind it. Turning more on later is additive; see
// `packages/catalog/.eslintrc.cjs` for what a fuller card-source config looks
// like, including the decorator handling the realm pipeline needs.
module.exports = {
  root: true,
  // Registered so the rule names in this package's existing `eslint-disable`
  // comments resolve, without turning their rules on. Those comments were
  // written for a lint run that did not reach here, so they have never done
  // anything; naming the plugins keeps them meaningful for whenever their
  // rules are switched on, rather than deleting intent that was correct all
  // along — the WebGL one in `file-formats/model3d-preview.gts` explains
  // itself, and would have to be rediscovered.
  plugins: ['@typescript-eslint', '@cardstack/boxel'],
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: { 'no-restricted-syntax': ['error', ...AMBIENT_CLOCK_SELECTORS] },
    },
    {
      files: ['**/*.gts'],
      parser: 'ember-eslint-parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: { 'no-restricted-syntax': ['error', ...AMBIENT_CLOCK_SELECTORS] },
    },
    {
      // The seam is the one place allowed to read the real clock.
      files: ['helpers/clock.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
};

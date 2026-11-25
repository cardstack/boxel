'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const rule = require('../../../lib/rules/mock-window-only');
const RuleTester = require('eslint').RuleTester;

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const message =
  'Use ember-window-mock window.localStorage instead of directly accessing localStorage';

ruleTester.run('mock-window-only', rule, {
  valid: [
    {
      code: `import window from 'ember-window-mock';
window.localStorage.getItem('key');`,
    },
  ],
  invalid: [
    {
      code: `localStorage.getItem('key');`,
      output: `import window from 'ember-window-mock';
window.localStorage.getItem('key');`,
      errors: [{ message }],
    },
    {
      code: `import window from 'ember-window-mock';
let value = localStorage.getItem('key');`,
      output: `import window from 'ember-window-mock';
let value = window.localStorage.getItem('key');`,
      errors: [{ message }],
    },
  ],
});

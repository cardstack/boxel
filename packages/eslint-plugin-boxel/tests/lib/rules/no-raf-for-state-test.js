'use strict';

const rule = require('../../../lib/rules/no-raf-for-state');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-raf-for-state', rule, {
  valid: [
    // Using scheduleOnce is fine
    {
      code: `import { scheduleOnce } from '@ember/runloop'; scheduleOnce('afterRender', this, this.doSomething);`,
    },
    // Using schedule is fine
    {
      code: `import { schedule } from '@ember/runloop'; schedule('afterRender', this, this.doSomething);`,
    },
    // cancelAnimationFrame is fine
    {
      code: `cancelAnimationFrame(id);`,
    },
    // Unrelated function calls
    {
      code: `setTimeout(() => {}, 100);`,
    },
  ],

  invalid: [
    // Direct requestAnimationFrame call
    {
      code: `requestAnimationFrame(() => { this.highlighted = true; });`,
      errors: [{ messageId: 'noRafForState' }],
    },
    // window.requestAnimationFrame call
    {
      code: `window.requestAnimationFrame(() => { this.highlighted = true; });`,
      errors: [{ messageId: 'noRafForState' }],
    },
    // requestAnimationFrame with named function
    {
      code: `requestAnimationFrame(this.activateFirstItem);`,
      errors: [{ messageId: 'noRafForState' }],
    },
    // requestAnimationFrame in arrow function
    {
      code: `let id = requestAnimationFrame(() => el.focus());`,
      errors: [{ messageId: 'noRafForState' }],
    },
  ],
});

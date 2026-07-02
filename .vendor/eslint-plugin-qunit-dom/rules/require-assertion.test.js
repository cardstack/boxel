const { RuleTester } = require('eslint');

const rule = require('./require-assertion');

let ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
});

ruleTester.run('require-assertion', rule, {
  valid: ['assert.dom().exists()', 'assert.dom(node).exists()'],

  invalid: [
    {
      code: 'assert.dom()',
      output: 'assert.dom().exists()',
      errors: [{ messageId: 'default' }],
    },
    {
      code: 'assert.dom(node)',
      output: 'assert.dom(node).exists()',
      errors: [{ messageId: 'default' }],
    },
  ],
});

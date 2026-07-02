const { RuleTester } = require('eslint');

const rule = require('./no-checked-selector');

let ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
});

ruleTester.run('no-checked-selector', rule, {
  valid: [
    'assert()',
    'assert.foo',
    "assert.foo('.foo:checked')",
    "notAssert.dom('.foo:checked')",
    "assert.dom('.foo:checked').somethingElse()",
    "assert.dom('.foo:checked').exists",
    "assert.dom(':checkedfoo').exists()",
    "assert.dom(':checked').exists()",
    'assert.dom().exists()',
    'assert.dom(node).exists()',
    'assert.dom(42).exists()',
  ],
  invalid: [
    // assert.dom('.foo:checked').exists()

    {
      code: "assert.dom('.foo:checked').exists();",
      output: "assert.dom('.foo').isChecked();",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.dom('.foo:checked').doesNotExist();",
      output: "assert.dom('.foo').isNotChecked();",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.dom('.foo:checked').exists('foo is checked');",
      output: "assert.dom('.foo').isChecked('foo is checked');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.dom('.foo:checked', root).exists('foo is checked');",
      output: "assert.dom('.foo', root).isChecked('foo is checked');",
      errors: [{ messageId: 'default' }],
    },

    // assert.ok(find('.foo:checked'))

    {
      code: "assert.ok(find('.foo:checked'));",
      output: "assert.dom('.foo').isChecked();",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.notOk(find('.foo:checked'));",
      output: "assert.dom('.foo').isNotChecked();",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.ok(find('.foo:checked'), 'foo is checked');",
      output: "assert.dom('.foo').isChecked('foo is checked');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.notOk(find('.foo:checked'), 'foo is not checked');",
      output: "assert.dom('.foo').isNotChecked('foo is not checked');",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.ok(find('.foo:checked', root), 'foo is checked');",
      output: "assert.dom('.foo', root).isChecked('foo is checked');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.notOk(find('.foo:checked', root), 'foo is not checked');",
      output: "assert.dom('.foo', root).isNotChecked('foo is not checked');",
      errors: [{ messageId: 'inverted' }],
    },

    // assert.equal(find('.foo:checked'), true)

    {
      code: "assert.equal(find('.foo:checked', root), true, 'foo is checked');",
      output: "assert.dom('.foo', root).isChecked('foo is checked');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.equal(find('.foo:checked', root), false, 'foo is not checked');",
      output: "assert.dom('.foo', root).isNotChecked('foo is not checked');",
      errors: [{ messageId: 'inverted' }],
    },

    // assert.equal(find('.foo:checked').length, 1)

    {
      code: "assert.equal(find('.foo:checked', root).length, 1, 'foo is checked');",
      output: "assert.dom('.foo', root).isChecked('foo is checked');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.strictEqual(find('.foo:checked', root).length, 1, 'foo is checked');",
      output: "assert.dom('.foo', root).isChecked('foo is checked');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.equal(find('.foo:checked', root).length, 0, 'foo is not checked');",
      output: "assert.dom('.foo', root).isNotChecked('foo is not checked');",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.strictEqual(find('.foo:checked', root).length, 0, 'foo is not checked');",
      output: "assert.dom('.foo', root).isNotChecked('foo is not checked');",
      errors: [{ messageId: 'inverted' }],
    },
  ],
});

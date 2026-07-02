const { RuleTester } = require('eslint');

const rule = require('./no-ok-find');

let ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
});

ruleTester.run('no-ok-find', rule, {
  valid: [
    "notAssert.ok(find('.foo'));",
    "assert.foo(find('.bar'));",
    'assert.ok;',
    'assert.ok();',
    'assert.ok(1);',
    "assert.ok(notFind('.foo'));",
    'assert.ok(find());',
    "assert.token(find('.foo'));",

    "notAssert.notOk(find('.foo'));",
    'assert.notOk;',
    'assert.notOk();',
    'assert.notOk(1);',
    "assert.notOk(notFind('.foo'));",
    'assert.notOk(find());',

    // from https://github.com/Mainmatter/qunit-dom-codemod/blob/master/__testfixtures__/qunit-dom-codemod/ok-find.input.js
    "assert.ok(find('input:first'));",
    "assert.ok(find('input:contains(foo)'));",
    "assert.equal(find('.foo'));",
    "assert.strictEqual(find('.foo'));",
    'assert.ok(true);',
    'assert.equal(foo(), true);',
    'assert.strictEqual(foo(), true);',

    // from https://github.com/Mainmatter/qunit-dom-codemod/blob/master/__testfixtures__/qunit-dom-codemod/ok-find.input.js
    "assert.notOk(find('input:first'));",
    "assert.notOk(find('input:contains(foo)'));",
    'assert.notOk(true);',

    "assert.equal(find('.foo'), 'foo');",
    'assert.equal(find(), true);',
    'assert.equal(find(42), true);',

    "assert.strictEqual(find('.foo'), true);",
    "assert.strictEqual(find('.foo')[0], true);",
    "assert.strictEqual(find('.foo'), true, 'custom message');",
    "assert.strictEqual(find('.foo')[0], true, 'custom message');",
    "assert.strictEqual(find('.foo', root), true);",
    "assert.strictEqual(find('.foo', root)[0], true);",

    "assert.strictEqual(find('.foo'), false);",
    "assert.strictEqual(find('.foo')[0], false);",
    "assert.strictEqual(find('.foo'), false, 'custom message');",
    "assert.strictEqual(find('.foo')[0], false, 'custom message');",
    "assert.strictEqual(find('.foo', root), false);",
    "assert.strictEqual(find('.foo', root)[0], false);",

    'assert.equal(find(42).length, 0);',
  ],

  invalid: [
    // from https://github.com/Mainmatter/qunit-dom-codemod/blob/master/__testfixtures__/qunit-dom-codemod/ok-find.input.js

    {
      code: "assert.ok(find('.foo'));",
      output: "assert.dom('.foo').exists();",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.ok(find('.foo')[0]);",
      output: "assert.dom('.foo').exists();",
      errors: [{ messageId: 'default' }],
    },
    {
      code: 'assert.ok(find(foo));',
      output: 'assert.dom(foo).exists();',
      errors: [{ messageId: 'default' }],
    },
    {
      code: 'assert.ok(find(foo.bar));',
      output: 'assert.dom(foo.bar).exists();',
      errors: [{ messageId: 'default' }],
    },

    {
      code: "assert.ok(find('.foo'), 'custom message');",
      output: "assert.dom('.foo').exists('custom message');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.ok(find('.foo')[0], 'custom message');",
      output: "assert.dom('.foo').exists('custom message');",
      errors: [{ messageId: 'default' }],
    },

    {
      code: "assert.ok(find('.foo', root));",
      output: "assert.dom('.foo', root).exists();",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.ok(find('.foo', root)[0]);",
      output: "assert.dom('.foo', root).exists();",
      errors: [{ messageId: 'default' }],
    },

    {
      code: "assert.equal(find('.foo'), true);",
      output: "assert.dom('.foo').exists();",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.equal(find('.foo')[0], true);",
      output: "assert.dom('.foo').exists();",
      errors: [{ messageId: 'default' }],
    },

    {
      code: "assert.equal(find('.foo'), true, 'custom message');",
      output: "assert.dom('.foo').exists('custom message');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.equal(find('.foo')[0], true, 'custom message');",
      output: "assert.dom('.foo').exists('custom message');",
      errors: [{ messageId: 'default' }],
    },

    {
      code: "assert.equal(find('.foo', root), true);",
      output: "assert.dom('.foo', root).exists();",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.equal(find('.foo', root)[0], true);",
      output: "assert.dom('.foo', root).exists();",
      errors: [{ messageId: 'default' }],
    },

    // from https://github.com/Mainmatter/qunit-dom-codemod/blob/master/__testfixtures__/qunit-dom-codemod/not-ok-find.input.js

    {
      code: "assert.notOk(find('.foo'));",
      output: "assert.dom('.foo').doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.notOk(find('.foo')[0]);",
      output: "assert.dom('.foo').doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: 'assert.notOk(find(foo));',
      output: 'assert.dom(foo).doesNotExist();',
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: 'assert.notOk(find(foo.bar));',
      output: 'assert.dom(foo.bar).doesNotExist();',
      errors: [{ messageId: 'inverted' }],
    },

    {
      code: "assert.notOk(find('.foo'), 'custom message');",
      output: "assert.dom('.foo').doesNotExist('custom message');",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.notOk(find('.foo')[0], 'custom message');",
      output: "assert.dom('.foo').doesNotExist('custom message');",
      errors: [{ messageId: 'inverted' }],
    },

    {
      code: "assert.notOk(find('.foo', root));",
      output: "assert.dom('.foo', root).doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.notOk(find('.foo', root)[0]);",
      output: "assert.dom('.foo', root).doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },

    {
      code: "assert.equal(find('.foo'), false);",
      output: "assert.dom('.foo').doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.equal(find('.foo')[0], false);",
      output: "assert.dom('.foo').doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },

    {
      code: "assert.equal(find('.foo'), false, 'custom message');",
      output: "assert.dom('.foo').doesNotExist('custom message');",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.equal(find('.foo')[0], false, 'custom message');",
      output: "assert.dom('.foo').doesNotExist('custom message');",
      errors: [{ messageId: 'inverted' }],
    },

    {
      code: "assert.equal(find('.foo', root), false);",
      output: "assert.dom('.foo', root).doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },
    {
      code: "assert.equal(find('.foo', root)[0], false);",
      output: "assert.dom('.foo', root).doesNotExist();",
      errors: [{ messageId: 'inverted' }],
    },

    {
      code: "assert.equal(find('.foo', root).length, 1, 'foo exists');",
      output: "assert.dom('.foo', root).exists('foo exists');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.equal(find('.foo', root).length, 0, 'foo does not exist');",
      output: "assert.dom('.foo', root).doesNotExist('foo does not exist');",
      errors: [{ messageId: 'inverted' }],
    },

    {
      code: "assert.strictEqual(find('.foo', root).length, 1, 'foo exists');",
      output: "assert.dom('.foo', root).exists('foo exists');",
      errors: [{ messageId: 'default' }],
    },
    {
      code: "assert.strictEqual(find('.foo', root).length, 0, 'foo does not exist');",
      output: "assert.dom('.foo', root).doesNotExist('foo does not exist');",
      errors: [{ messageId: 'inverted' }],
    },
  ],
});

const ASSERT_DOM_SELECTOR =
  'CallExpression' +
  '[callee.type="MemberExpression"]' +
  '[callee.object.type="Identifier"]' +
  '[callee.object.name="assert"]' +
  '[callee.property.type="Identifier"]' +
  '[callee.property.name="dom"]';

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require at least one assertion on `assert.dom()`',
      recommended: true,
      url: 'https://github.com/Mainmatter/eslint-plugin-qunit-dom/blob/main/rules/require-assertion.md',
    },
    fixable: 'code',
    schema: [],
    messages: {
      default: 'use at least one assertion on assert.dom(...)',
    },
  },

  create(context) {
    return {
      [ASSERT_DOM_SELECTOR](node) {
        if (node.parent.type === 'ExpressionStatement') {
          context.report({
            node: node,
            messageId: 'default',
            fix(fixer) {
              return fixer.insertTextAfter(node, '.exists()');
            },
          });
        } else {
          return;
        }
      },
    };
  },
};

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow committing of pauseTest',
      category: 'Testing',
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      noPauseTest: 'pauseTest() should not be committed',
    },
  },
  create(context) {
    const filename = context.getFilename();

    return {
      // Catch standalone pauseTest() calls
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'pauseTest'
        ) {
          context.report({
            node,
            messageId: 'noPauseTest',
          });
        }
      },

      // Catch this.pauseTest() calls
      MemberExpression(node) {
        if (
          node.object.type === 'ThisExpression' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'pauseTest'
        ) {
          // Check if this is part of a call expression
          const parent = node.parent;
          if (
            parent &&
            parent.type === 'CallExpression' &&
            parent.callee === node
          ) {
            context.report({
              node: parent,
              messageId: 'noPauseTest',
            });
          }
        }
      },
    };
  },
};

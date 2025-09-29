module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of window mock localStorage',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
  },
  create(context) {
    let importAdded = false;

    return {
      Program(node) {
        importAdded = node.body.some(
          (n) =>
            n.type === 'ImportDeclaration' &&
            n.source.value === 'ember-window-mock',
        );
      },
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'localStorage' &&
          !context
            .getAncestors()
            .some(
              (ancestor) =>
                ancestor.type === 'MemberExpression' &&
                ancestor.object.name === 'window',
            )
        ) {
          context.report({
            node,
            message:
              'Use ember-window-mock window.localStorage instead of directly accessing localStorage',
            fix(fixer) {
              const fixes = [fixer.insertTextBefore(node, 'window.')];

              if (!importAdded) {
                fixes.unshift(
                  fixer.insertTextBefore(
                    context.getSourceCode().ast.body[0],
                    "import window from 'ember-window-mock';\n",
                  ),
                );
                importAdded = true;
              }

              return fixes;
            },
          });
        }
      },
    };
  },
};

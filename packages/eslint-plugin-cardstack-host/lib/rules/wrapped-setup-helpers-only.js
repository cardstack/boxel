module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce use of wrapped setup helpers that use ember-window-mock',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'ember-qunit') {
          node.specifiers.forEach((specifier) => {
            if (
              specifier.type === 'ImportSpecifier' &&
              (specifier.imported.name === 'setupApplicationTest' ||
                specifier.imported.name === 'setupRenderingTest')
            ) {
              context.report({
                node: specifier,
                message: `Importing ${specifier.imported.name} from ember-qunit is not allowed. Use host application’s wrapped setup helpers instead.`,
              });
            }
          });
        }
      },
    };
  },
};

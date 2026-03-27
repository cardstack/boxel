'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid importing percySnapshot directly from @percy/ember; use @cardstack/host/tests/helpers instead',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noPercyDirectImport:
        "Do not import directly from '@percy/ember'. Use `import { percySnapshot } from '@cardstack/host/tests/helpers'` instead.",
    },
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === '@percy/ember') {
          context.report({
            node,
            messageId: 'noPercyDirectImport',
            fix(fixer) {
              return fixer.replaceText(
                node,
                "import { percySnapshot } from '@cardstack/host/tests/helpers';",
              );
            },
          });
        }
      },
    };
  },
};

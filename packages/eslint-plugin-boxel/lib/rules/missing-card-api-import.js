const { fixMissingImport, isBound } = require('../utils/import-utils');

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow usage of card-api with missing imports with auto-fix',
      category: 'Ember Octane',
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/missing-card-api-import.md',
      recommended: true,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          importMappings: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              prefixItems: [
                {
                  type: 'string',
                  description: 'The name to import from the module',
                },
                { type: 'string', description: 'The module to import from' },
              ],
            },
          },
        },
      },
    ],
    messages: {
      'missing-card-api-import':
        'Not in scope. Did you forget to import this? Auto-fix may be configured.',
    },
  },

  create: (context) => {
    const sourceCode = context.sourceCode;

    // Checks if a class extends another class and validates the base class is in scope
    function checkBaseClass(node) {
      if (node.superClass) {
        // For direct identifier references like "extends BaseClass"
        if (node.superClass.type === 'Identifier') {
          const baseClassName = node.superClass.name;
          if (!isBound(node.superClass, sourceCode.getScope(node))) {
            const matched = context.options[0]?.importMappings?.[baseClassName];
            if (matched) {
              const [exportName, moduleName] = matched;
              context.report({
                node: node.superClass,
                messageId: 'missing-card-api-import',
                fix(fixer) {
                  return fixMissingImport(
                    fixer,
                    sourceCode,
                    baseClassName,
                    exportName,
                    moduleName,
                  );
                },
              });
            }
          }
        }
      }
    }

    return {
      // Handle regular JavaScript/TypeScript class declarations
      ClassDeclaration(node) {
        checkBaseClass(node);
      },
      // Handle class expressions (like in variable declarations)
      ClassExpression(node) {
        checkBaseClass(node);
      },
    };
  },
};

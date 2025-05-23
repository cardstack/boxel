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

    // Track which nodes we've already reported
    const reportedNodes = new Set();

    // Check for identifiers that should be imported
    function checkMissingImport(node, isClassExtends = false) {
      if (node.type !== 'Identifier') {
        return;
      }

      const identifierName = node.name;

      // Skip if the identifier is already in scope or already reported
      if (reportedNodes.has(node) || isBound(node, sourceCode.getScope(node))) {
        return;
      }

      const matched = context.options[0]?.importMappings?.[identifierName];
      if (Array.isArray(matched) && matched.length == 2) {
        reportedNodes.add(node);
        const [exportName, moduleName] = matched;
        context.report({
          node: node,
          messageId: 'missing-card-api-import',
          fix(fixer) {
            return fixMissingImport(
              fixer,
              sourceCode,
              identifierName,
              exportName,
              moduleName,
            );
          },
        });
      }
    }

    return {
      // Check for identifiers used throughout the code
      Identifier(node) {
        // Skip identifiers that are part of property access (e.g., obj.prop)
        if (
          node.parent &&
          node.parent.type === 'MemberExpression' &&
          node.parent.property === node
        ) {
          return;
        }

        // Skip identifiers that are property keys (e.g., { prop: value })
        if (
          node.parent &&
          node.parent.type === 'Property' &&
          node.parent.key === node &&
          !node.parent.computed
        ) {
          return;
        }

        checkMissingImport(node);
      },
    };
  },
};

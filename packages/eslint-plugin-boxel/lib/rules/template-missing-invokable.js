const { fixMissingImport, isBound } = require('../utils/import-utils');

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow missing helpers, modifiers, or components in \\<template\\> with auto-fix to import them',
      category: 'Ember Octane',
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/template-missing-invokable.md',
      recommended: true,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          invokables: {
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
      'missing-invokable':
        'Not in scope. Did you forget to import this? Auto-fix may be configured.',
    },
  },

  create: (context) => {
    const sourceCode = context.sourceCode;

    // takes a node with a `.path` property
    function checkInvokable(node) {
      if (
        node.path.type === 'GlimmerPathExpression' &&
        node.path.tail.length === 0
      ) {
        if (!isBound(node.path.head, sourceCode.getScope(node.path))) {
          const matched = context.options[0]?.invokables?.[node.path.head.name];
          // Currently, we don't report errors unless we have a configured fix. We will likely
          // change this in the future to report all missing invokables when we are ready with
          // a way to share this information in the UI and or to the AI Assistant.
          if (matched) {
            const [exportName, moduleName] = matched;
            context.report({
              node: node.path,
              messageId: 'missing-invokable',
              fix(fixer) {
                return fixMissingImport(
                  fixer,
                  sourceCode,
                  node.path.head.name,
                  exportName,
                  moduleName,
                );
              },
            });
          }
        }
      }
    }

    return {
      GlimmerSubExpression(node) {
        return checkInvokable(node);
      },
      GlimmerElementModifierStatement(node) {
        return checkInvokable(node);
      },
      GlimmerMustacheStatement(node) {
        return checkInvokable(node);
      },
    };
  },
};

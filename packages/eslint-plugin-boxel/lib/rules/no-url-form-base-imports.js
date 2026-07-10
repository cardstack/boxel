'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const URL_FORM_PREFIX = 'https://cardstack.com/base/';
const CANONICAL_PREFIX = '@cardstack/base/';

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow URL-form base-module import specifiers; use @cardstack/base/ with auto-fix',
      category: 'Best Practices',
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/no-url-form-base-imports.md',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      'no-url-form-base-imports':
        'Use "{{canonical}}" instead of the URL-form specifier "{{specifier}}".',
    },
  },

  create(context) {
    function check(literalNode) {
      if (
        !literalNode ||
        literalNode.type !== 'Literal' ||
        typeof literalNode.value !== 'string' ||
        !literalNode.value.startsWith(URL_FORM_PREFIX)
      ) {
        return;
      }
      let specifier = literalNode.value;
      let canonical =
        CANONICAL_PREFIX + specifier.slice(URL_FORM_PREFIX.length);
      context.report({
        node: literalNode,
        messageId: 'no-url-form-base-imports',
        data: { specifier, canonical },
        fix(fixer) {
          let quote = literalNode.raw[0];
          return fixer.replaceText(
            literalNode,
            `${quote}${canonical}${quote}`,
          );
        },
      });
    }

    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        check(node.source);
      },
      ExportAllDeclaration(node) {
        check(node.source);
      },
      ImportExpression(node) {
        check(node.source);
      },
      // Loader-style dynamic imports: `loader.import('…')`,
      // `this.loaderService.loader.import('…')`, etc. The specifier is the
      // first argument.
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'import' &&
          node.arguments.length > 0
        ) {
          check(node.arguments[0]);
        }
      },
    };
  },
};

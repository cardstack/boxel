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
    function canonicalFor(specifier) {
      return CANONICAL_PREFIX + specifier.slice(URL_FORM_PREFIX.length);
    }

    function report(node, specifier, fix) {
      context.report({
        node,
        messageId: 'no-url-form-base-imports',
        data: { specifier, canonical: canonicalFor(specifier) },
        fix,
      });
    }

    function checkLiteral(literalNode) {
      if (
        literalNode.type !== 'Literal' ||
        typeof literalNode.value !== 'string' ||
        !literalNode.value.startsWith(URL_FORM_PREFIX)
      ) {
        return;
      }
      report(literalNode, literalNode.value, (fixer) => {
        // Derive the quote from the source text rather than `literalNode.raw`,
        // which isn't guaranteed to be populated across parsers/AST transforms.
        let quote = context.sourceCode.getText(literalNode)[0];
        return fixer.replaceText(
          literalNode,
          `${quote}${canonicalFor(literalNode.value)}${quote}`,
        );
      });
    }

    // A template literal's leading spelling decides which module it names, so
    // only that is read: the first quasi when it has text, otherwise what is
    // interpolated first — a string literal
    // (`${'https://cardstack.com/base/'}x`) or `baseRealm.url`.
    function checkTemplateLiteral(node) {
      let first = node.quasis[0];
      if (first.value.raw !== '') {
        if (!first.value.raw.startsWith(URL_FORM_PREFIX)) {
          return;
        }
        let specifier = context.sourceCode.getText(node).slice(1, -1);
        report(node, specifier, (fixer) => {
          // The quasi's range starts at the opening backtick.
          let start = first.range[0] + 1;
          return fixer.replaceTextRange(
            [start, start + URL_FORM_PREFIX.length],
            CANONICAL_PREFIX,
          );
        });
        return;
      }
      let lead = node.expressions[0];
      if (isBaseRealmURL(lead)) {
        let specifier = context.sourceCode.getText(node).slice(1, -1);
        report(
          node,
          specifier.replace(/^\$\{[^}]*\}/, URL_FORM_PREFIX),
          (fixer) =>
            // From after the opening backtick through the `}` closing the
            // interpolation, which starts the second quasi.
            fixer.replaceTextRange(
              [node.range[0] + 1, node.quasis[1].range[0] + 1],
              CANONICAL_PREFIX,
            ),
        );
        return;
      }
      check(lead);
    }

    // `baseRealm.url`, the runtime-common constant that holds the URL form.
    function isBaseRealmURL(node) {
      return (
        node &&
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.object.type === 'Identifier' &&
        node.object.name === 'baseRealm' &&
        node.property.type === 'Identifier' &&
        node.property.name === 'url'
      );
    }

    function check(node) {
      if (!node) {
        return;
      }
      if (node.type === 'Literal') {
        checkLiteral(node);
      } else if (node.type === 'TemplateLiteral') {
        checkTemplateLiteral(node);
      }
    }

    // `importResource(this, () => '…')` names its module in the body of the
    // thunk it is passed second.
    function importResourceSpecifier(node) {
      let thunk = node.arguments[1];
      if (
        thunk &&
        thunk.type === 'ArrowFunctionExpression' &&
        thunk.body.type !== 'BlockStatement'
      ) {
        return thunk.body;
      }
      return undefined;
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
      CallExpression(node) {
        // Loader-style dynamic imports: `loader.import('…')`,
        // `this.loaderService.loader.import('…')`, etc. The specifier is the
        // first argument.
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'import' &&
          node.arguments.length > 0
        ) {
          check(node.arguments[0]);
          return;
        }
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'importResource'
        ) {
          check(importResourceSpecifier(node));
        }
      },
    };
  },
};

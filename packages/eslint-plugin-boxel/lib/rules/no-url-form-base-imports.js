'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const { PREFIX_REALM_ALIASES } = require('../utils/prefix-realms');

// The base realm's prefix and the alias it answers to, from the plugin's
// restatement of `PREFIX_REALMS`.
const CANONICAL_PREFIX = '@cardstack/base/';
const URL_FORM_PREFIX = PREFIX_REALM_ALIASES[CANONICAL_PREFIX];
if (!URL_FORM_PREFIX) {
  throw new Error(
    `PREFIX_REALMS gives ${CANONICAL_PREFIX} no alias, so no-url-form-base-imports has nothing to check`,
  );
}

// The first character of a path appended to a realm URL, as against a
// delimiter that closes the URL inside a larger string.
const URL_PATH_START = /^[A-Za-z0-9_.~%@/-]/;

// The alias is the base realm's registered identity, so code that defines that
// identity or recognizes data written in it may spell it out. These are the
// functions that do; `baseRealm` is the constant that holds it.
const ALIAS_DEFINING_VARIABLES = new Set(['baseRealm']);
const ALIAS_RECOGNIZING_FUNCTIONS = new Set([
  'equivalentURLForms',
  'internalKeyFor',
  'registeredRealmURL',
]);

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow the https://cardstack.com/base/ alias outside the positions that define or recognize it; auto-fix import specifiers to @cardstack/base/',
      category: 'Best Practices',
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/no-url-form-base-imports.md',
      recommended: true,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          // For a test of alias tolerance, canonicalization or migration,
          // which spells the alias as data. Import positions are still
          // checked.
          allowAliasOutsideImports: { type: 'boolean' },
          // For a file listed as a known gap that builds alias-form resources
          // from `baseRealm.url`. Those forms are allowed outside import
          // positions; the alias spelled out is still reported.
          allowBaseRealmURLPaths: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      'no-url-form-base-imports':
        'Use "{{canonical}}" instead of the URL-form specifier "{{specifier}}".',
      builtURLFormSpecifier:
        'Import the base-realm module as "@cardstack/base/…" rather than building its URL-form specifier from `baseRealm.url`.',
      aliasOutsideAllowedPosition:
        "The `https://cardstack.com/base/` alias may appear only in `baseRealm`, the base realm's registration and permission rows, `registeredRealmURL`, code that recognizes legacy alias data, and tests of alias tolerance, canonicalization or migration. Name a base-realm resource as `@cardstack/base/…`. `baseRealm.url` is read where the base realm's registered URL itself is meant; a path appended to it spells the alias. Code that recognizes legacy alias data outside the functions this rule knows disables it on the line and says so in the reason.",
    },
  },

  create(context) {
    let { allowAliasOutsideImports = false, allowBaseRealmURLPaths = false } =
      context.options[0] || {};
    // Every node read as an import specifier, reported or not, so the check
    // for other positions leaves it alone.
    let importPositions = new Set();

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

    // `baseRealm.url + path`.
    function isBaseRealmURLConcatenation(node) {
      return (
        node.type === 'BinaryExpression' &&
        node.operator === '+' &&
        isBaseRealmURL(node.left)
      );
    }

    // `new URL(path, baseRealm.url)`. `new URL(baseRealm.url)` parses the
    // registered URL itself, so it is not one.
    function isURLUnderBaseRealmURL(node) {
      return (
        node.type === 'NewExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'URL' &&
        isBaseRealmURL(node.arguments[1])
      );
    }

    // The `baseRealm.url + path` or `new URL(path, baseRealm.url)` a specifier
    // is built from, reading through a trailing `.href`.
    function builtFromBaseRealmURL(node) {
      let built =
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === 'href'
          ? node.object
          : node;
      return isBaseRealmURLConcatenation(built) || isURLUnderBaseRealmURL(built)
        ? built
        : undefined;
    }

    // Marks each node it reads as an import specifier, so the check for other
    // positions leaves it alone. A specifier built from `baseRealm.url` has no
    // spelling to rewrite, so it is reported without a fix.
    function check(node) {
      if (!node) {
        return;
      }
      if (node.type === 'Literal') {
        importPositions.add(node);
        checkLiteral(node);
      } else if (node.type === 'TemplateLiteral') {
        importPositions.add(node);
        checkTemplateLiteral(node);
      } else {
        let built = builtFromBaseRealmURL(node);
        if (built) {
          importPositions.add(built);
          context.report({ node, messageId: 'builtURLFormSpecifier' });
        }
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

    function functionName(node) {
      if (node.id && node.id.type === 'Identifier') {
        return node.id.name;
      }
      let parent = node.parent;
      if (
        parent &&
        (parent.type === 'MethodDefinition' || parent.type === 'Property') &&
        parent.key.type === 'Identifier'
      ) {
        return parent.key.name;
      }
      if (
        parent &&
        parent.type === 'VariableDeclarator' &&
        parent.id.type === 'Identifier'
      ) {
        return parent.id.name;
      }
      return undefined;
    }

    function inAllowedPosition(node) {
      for (let ancestor of context.sourceCode.getAncestors(node)) {
        if (
          ancestor.type === 'VariableDeclarator' &&
          ancestor.id.type === 'Identifier' &&
          ALIAS_DEFINING_VARIABLES.has(ancestor.id.name)
        ) {
          return true;
        }
        if (
          (ancestor.type === 'FunctionDeclaration' ||
            ancestor.type === 'FunctionExpression' ||
            ancestor.type === 'ArrowFunctionExpression') &&
          ALIAS_RECOGNIZING_FUNCTIONS.has(functionName(ancestor))
        ) {
          return true;
        }
      }
      return false;
    }

    // What a template literal spells. `baseRealm.url` is the alias, so where a
    // path follows it the template spells an alias-form resource, and the
    // alias stands in for it in the text. Where a delimiter or nothing follows
    // it, as in `[data-test-realm-url="${baseRealm.url}"]`, the template
    // embeds the registered URL itself, read as `baseRealm.url` is.
    function templateText(node) {
      let text = '';
      node.quasis.forEach((quasi, index) => {
        text += quasi.value.raw;
        let expression = node.expressions[index];
        if (!expression) {
          return;
        }
        let next = node.quasis[index + 1].value.raw;
        let followedByPath =
          next === ''
            ? index + 1 < node.expressions.length
            : URL_PATH_START.test(next);
        if (isBaseRealmURL(expression) && followedByPath) {
          text += URL_FORM_PREFIX;
        }
      });
      return text;
    }

    function checkOtherPosition(node, text) {
      if (
        allowAliasOutsideImports ||
        importPositions.has(node) ||
        !text.includes(URL_FORM_PREFIX) ||
        inAllowedPosition(node)
      ) {
        return;
      }
      context.report({
        node,
        messageId: 'aliasOutsideAllowedPosition',
        fix: codeRefModuleFix(node),
      });
    }

    // A string that is the whole `module` of a code ref names a base-realm
    // module, which has a prefix spelling to rewrite it to. Anywhere else the
    // alias may be a URL something fetches or compares, so it is left for the
    // author.
    function codeRefModuleFix(node) {
      let parent = node.parent;
      if (
        node.type !== 'Literal' ||
        !node.value.startsWith(URL_FORM_PREFIX) ||
        !parent ||
        parent.type !== 'Property' ||
        parent.value !== node ||
        parent.computed ||
        !(
          (parent.key.type === 'Identifier' && parent.key.name === 'module') ||
          (parent.key.type === 'Literal' && parent.key.value === 'module')
        )
      ) {
        return undefined;
      }
      return (fixer) => {
        let quote = context.sourceCode.getText(node)[0];
        return fixer.replaceText(
          node,
          `${quote}${canonicalFor(node.value)}${quote}`,
        );
      };
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
      // `typeof import('…')` in a type position.
      TSImportType(node) {
        // `source` is the specifier itself; parsers that predate it wrap the
        // specifier in a literal type under `argument`.
        if (node.source) {
          check(node.source);
          return;
        }
        let argument = node.argument;
        check(
          argument && argument.type === 'TSLiteralType'
            ? argument.literal
            : argument,
        );
      },
      // Visited after the import positions that contain them, so a specifier
      // is already known to be one.
      Literal(node) {
        if (typeof node.value === 'string') {
          checkOtherPosition(node, node.value);
        }
      },
      // Under `allowBaseRealmURLPaths`, only what the template spells out.
      TemplateLiteral(node) {
        checkOtherPosition(
          node,
          allowBaseRealmURLPaths
            ? node.quasis.map((quasi) => quasi.value.raw).join('')
            : templateText(node),
        );
      },
      // `baseRealm.url + path` spells an alias-form resource, as the template
      // does.
      BinaryExpression(node) {
        if (!allowBaseRealmURLPaths && isBaseRealmURLConcatenation(node)) {
          checkOtherPosition(node, URL_FORM_PREFIX);
        }
      },
      // `new URL(path, baseRealm.url)` resolves a path under the alias.
      NewExpression(node) {
        if (!allowBaseRealmURLPaths && isURLUnderBaseRealmURL(node)) {
          checkOtherPosition(node, URL_FORM_PREFIX);
        }
      },
      // A `<template>`'s text and attribute values, and its string arguments.
      GlimmerTextNode(node) {
        checkOtherPosition(node, node.chars);
      },
      GlimmerStringLiteral(node) {
        checkOtherPosition(node, node.value);
      },
    };
  },
};

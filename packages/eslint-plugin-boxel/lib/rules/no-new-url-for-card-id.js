'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Variable name patterns that indicate a card/module identifier which may be
// in prefix form (e.g. @cardstack/base/card-api) and therefore cannot be
// passed to `new URL()` directly.  Use `cardIdToURL()` instead.
const CARD_ID_PATTERNS = [
  /^card(?:Id|URL|Url|DefRef)$/i,
  /^module(?:Identifier|URL|Url|Href|Ref)$/i,
  /^(?:spec|source|target)(?:Id|Url|URL|Ref)$/i,
  /^(?:code|adopts)Ref$/i,
  /^dep$/i,
  /^id$/,
  /^url$/,
  /^value$/,
  /Id$/,
];

// Property access patterns like ref.module, codeRef.module, spec.id
const CARD_ID_PROPERTY_PATTERNS = [
  /\.module$/,
  /\.id$/,
  /\.moduleHref$/,
  /\.sourceUrl$/,
];

function getArgumentText(node, sourceCode) {
  return sourceCode.getText(node);
}

function looksLikeCardId(argNode, sourceCode) {
  // Skip string literals that are clearly URLs
  if (argNode.type === 'Literal' && typeof argNode.value === 'string') {
    if (/^https?:\/\//.test(argNode.value) || /^data:/.test(argNode.value) || /^blob:/.test(argNode.value)) {
      return false;
    }
  }

  // Skip template literals (usually constructed URLs)
  if (argNode.type === 'TemplateLiteral') {
    return false;
  }

  let text = getArgumentText(argNode, sourceCode);

  // Check member expression patterns (ref.module, spec.id, etc.)
  if (argNode.type === 'MemberExpression') {
    for (let pattern of CARD_ID_PROPERTY_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
  }

  // Check variable name patterns
  if (argNode.type === 'Identifier') {
    for (let pattern of CARD_ID_PATTERNS) {
      if (pattern.test(argNode.name)) {
        return true;
      }
    }
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `new URL()` on card/module identifiers that may be in prefix form; use `cardIdToURL()` instead',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noNewUrlForCardId:
        'Use `cardIdToURL({{arg}})` instead of `new URL({{arg}})` — the argument may be a prefix-form identifier like @cardstack/base/... which is not a valid URL.',
    },
  },

  create(context) {
    return {
      NewExpression(node) {
        // Only match `new URL(...)`
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'URL'
        ) {
          return;
        }

        // Only single-argument form (two-argument `new URL(path, base)` is fine)
        if (node.arguments.length !== 1) {
          return;
        }

        let arg = node.arguments[0];
        let sourceCode = context.sourceCode || context.getSourceCode();

        if (!looksLikeCardId(arg, sourceCode)) {
          return;
        }

        let argText = getArgumentText(arg, sourceCode);
        context.report({
          node,
          messageId: 'noNewUrlForCardId',
          data: { arg: argText },
          fix(fixer) {
            return fixer.replaceText(node, `cardIdToURL(${argText})`);
          },
        });
      },
    };
  },
};

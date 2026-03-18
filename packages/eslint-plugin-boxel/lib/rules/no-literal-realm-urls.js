'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Maps each registered prefix to the set of environment-specific base URLs
// that should be replaced by it. Order matters: longer/more-specific URLs
// should come first if there is any overlap.
const DEFAULT_REALM_MAPPINGS = [
  {
    prefix: '@cardstack/catalog/',
    urls: [
      'http://localhost:4201/catalog/',
      'https://realms-staging.stack.cards/catalog/',
      'https://app.boxel.ai/catalog/',
    ],
  },
  // Future entries:
  // {
  //   prefix: '@cardstack/skills/',
  //   urls: [
  //     'http://localhost:4201/skills/',
  //     'https://realms-staging.stack.cards/skills/',
  //     'https://app.boxel.ai/skills/',
  //   ],
  // },
  // {
  //   prefix: '@cardstack/base/',
  //   urls: [
  //     'https://cardstack.com/base/',
  //   ],
  // },
];

/**
 * Build a flat list of { url, prefix } pairs from the realm mappings,
 * sorted longest-URL-first so that replacements are unambiguous.
 */
function buildReplacements(mappings) {
  let pairs = [];
  for (let mapping of mappings) {
    for (let url of mapping.urls) {
      pairs.push({ url, prefix: mapping.prefix });
    }
  }
  // Sort longest first so we don't accidentally match a shorter prefix
  pairs.sort((a, b) => b.url.length - a.url.length);
  return pairs;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow environment-specific realm URLs in code; use portable prefixes like @cardstack/catalog/ instead',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          realmMappings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                prefix: { type: 'string' },
                urls: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['prefix', 'urls'],
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noLiteralRealmUrl:
        'Use "{{prefix}}" instead of the environment-specific URL "{{url}}".',
    },
  },

  create(context) {
    let options = context.options[0] || {};
    let mappings = options.realmMappings || DEFAULT_REALM_MAPPINGS;
    let replacements = buildReplacements(mappings);

    /**
     * Check a string value for environment-specific realm URLs and report/fix.
     * @param {import('estree').Node} node - The Literal or TemplateLiteral node
     * @param {string} value - The string content to check
     */
    function checkStringValue(node, value) {
      for (let { url, prefix } of replacements) {
        if (value.includes(url)) {
          context.report({
            node,
            messageId: 'noLiteralRealmUrl',
            data: { prefix, url },
            fix(fixer) {
              let raw = context.sourceCode.getText(node);
              let fixed = raw.split(url).join(prefix);
              return fixer.replaceText(node, fixed);
            },
          });
          // Report only the first match per node to keep fixes simple
          return;
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          checkStringValue(node, node.value);
        }
      },
      TemplateLiteral(node) {
        // Check each quasi (static part) of the template literal
        for (let quasi of node.quasis) {
          let value = quasi.value.cooked || quasi.value.raw;
          for (let { url, prefix } of replacements) {
            if (value.includes(url)) {
              context.report({
                node,
                messageId: 'noLiteralRealmUrl',
                data: { prefix, url },
                fix(fixer) {
                  let raw = context.sourceCode.getText(node);
                  let fixed = raw.split(url).join(prefix);
                  return fixer.replaceText(node, fixed);
                },
              });
              return;
            }
          }
        }
      },
    };
  },
};

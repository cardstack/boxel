'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Maps each registered prefix to the set of environment-specific base URLs
// that should be replaced by it, plus optional regex patterns for dynamic
// URLs (e.g. environment-mode *.localhost subdomains).
const DEFAULT_REALM_MAPPINGS = [
  {
    prefix: '@cardstack/catalog/',
    urls: [
      'http://localhost:4201/catalog/',
      'https://realms-staging.stack.cards/catalog/',
      'https://app.boxel.ai/catalog/',
    ],
    // Catches environment-mode URLs like http://realm-server.linty.localhost/catalog/
    patterns: ['https?://realm-server\\.[^.]+\\.localhost(:\\d+)?/catalog/'],
  },
  // Future entries:
  // {
  //   prefix: '@cardstack/skills/',
  //   urls: [
  //     'http://localhost:4201/skills/',
  //     'https://realms-staging.stack.cards/skills/',
  //     'https://app.boxel.ai/skills/',
  //   ],
  //   patterns: ['https?://[^/]+\\.localhost[^/]*/skills/'],
  // },
  // {
  //   prefix: '@cardstack/base/',
  //   urls: [
  //     '@cardstack/base/',
  //   ],
  // },
];

/**
 * Build a flat list of { url, prefix } pairs from the realm mappings,
 * sorted longest-URL-first so that replacements are unambiguous.
 */
function buildExactReplacements(mappings) {
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

/**
 * Build a list of { regex, prefix } from pattern-based mappings.
 * Each pattern should match the full base URL up to and including
 * the realm path segment (e.g. the catalog/ portion).
 */
function buildPatternReplacements(mappings) {
  let result = [];
  for (let mapping of mappings) {
    if (!mapping.patterns) {
      continue;
    }
    for (let pattern of mapping.patterns) {
      result.push({
        regex: new RegExp(pattern),
        prefix: mapping.prefix,
      });
    }
  }
  return result;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow environment-specific realm URLs in code; use portable prefixes like @cardstack/catalog/ instead',
      category: 'Best Practices',
      recommended: false,
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
                patterns: {
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
    let exactReplacements = buildExactReplacements(mappings);
    let patternReplacements = buildPatternReplacements(mappings);

    /**
     * Try exact URL matches first, then regex patterns.
     * Returns { matchedUrl, prefix } or null.
     */
    function findMatch(value) {
      // Exact matches take priority
      for (let { url, prefix } of exactReplacements) {
        if (value.includes(url)) {
          return { matchedUrl: url, prefix };
        }
      }
      // Then try regex patterns
      for (let { regex, prefix } of patternReplacements) {
        let match = regex.exec(value);
        if (match) {
          return { matchedUrl: match[0], prefix };
        }
      }
      return null;
    }

    /**
     * Check a string value for environment-specific realm URLs and report/fix.
     */
    function checkAndReport(node, value) {
      let result = findMatch(value);
      if (!result) {
        return;
      }
      let { matchedUrl, prefix } = result;
      context.report({
        node,
        messageId: 'noLiteralRealmUrl',
        data: { prefix, url: matchedUrl },
        fix(fixer) {
          let raw = context.sourceCode.getText(node);
          let fixed = raw.split(matchedUrl).join(prefix);
          return fixer.replaceText(node, fixed);
        },
      });
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          checkAndReport(node, node.value);
        }
      },
      TemplateLiteral(node) {
        // For template literals, check the full source text so we catch
        // URLs that span a single quasi segment
        let fullText = context.sourceCode.getText(node);
        checkAndReport(node, fullText);
      },
    };
  },
};

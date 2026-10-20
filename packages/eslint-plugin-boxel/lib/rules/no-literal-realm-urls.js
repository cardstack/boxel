'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

const { PREFIX_REALM_PREFIXES } = require('../utils/prefix-realms');

// The origins a realm server is reached at in development, staging and
// production. Each serves every prefix realm at the path named after it:
// `@cardstack/skills/` is `<origin>/skills/`.
const REALM_SERVER_ORIGINS = [
  'http://localhost:4201',
  'https://localhost:4201',
  'https://realms-staging.stack.cards',
  'https://app.boxel.ai',
];

// Environment-mode realm servers, such as
// `http://realm-server.linty.localhost/` or one with a port.
const ENVIRONMENT_MODE_ORIGIN_PATTERN =
  'https?://realm-server\\.[^.]+\\.localhost(:\\d+)?';

// Maps each registered prefix to the environment-specific base URLs that
// should be replaced by it, plus regex patterns for dynamic URLs. The base
// realm's `https://cardstack.com/base/` alias is not among them: it is a
// fetch target in its own right.
const DEFAULT_REALM_MAPPINGS = PREFIX_REALM_PREFIXES.map((prefix) => {
  let realmPath = `/${prefix.slice('@cardstack/'.length)}`;
  return {
    prefix,
    urls: REALM_SERVER_ORIGINS.map((origin) => `${origin}${realmPath}`),
    patterns: [`${ENVIRONMENT_MODE_ORIGIN_PATTERN}${realmPath}`],
  };
});

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
        'Disallow environment-specific realm URLs in code; use the registered prefixes like @cardstack/catalog/ instead',
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

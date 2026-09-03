'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Hosts a realm image may legitimately be served from. `boxel-images.boxel.ai`
// is ours: it backs the default icon and background lists that real workspaces
// are created with, so fixtures that want to look like a real workspace point
// at it too.
const DEFAULT_ALLOWED_HOSTS = ['boxel-images.boxel.ai'];

// The realm-config fields whose value the app renders as an image — an <img>
// src or a CSS `background-image` — rather than merely storing or asserting on.
const IMAGE_URL_PROPERTIES = new Set(['iconURL', 'backgroundURL']);

// A value that reaches a third party is remote however it is spelled. Two
// separators do that with no scheme at all, because the browser borrows the
// page's, and the URL parser treats a backslash as a slash after a special
// scheme — so `//host`, `\\host`, `\/host` and `/\host` all resolve to the
// same origin. One separator is what stays local, and it is the form this rule
// wants fixtures to use, so the difference between one and two is load-bearing.
const REMOTE_URL = /^(?:https?:)?[/\\]{2}/i;

function propertyKeyName(node) {
  if (node.computed) {
    return null;
  }
  if (node.key.type === 'Identifier') {
    return node.key.name;
  }
  if (node.key.type === 'Literal') {
    return String(node.key.value);
  }
  return null;
}

// The value as a string, when that can be known statically. Covers a literal
// written in place and the common indirection of a module-level `const` holding
// the URL, which is how several fixtures spell it. Anything else — a call, a
// template with an expression, a value from another module — is left alone
// rather than guessed at.
function staticStringValue(node, scope) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  if (node.type === 'Identifier' && scope) {
    let variable = findVariable(scope, node.name);
    // Only a single assignment can be reasoned about; a reassigned binding
    // could hold anything by the time it is used.
    if (
      variable &&
      variable.defs.length === 1 &&
      variable.references.filter((ref) => ref.isWrite()).length <= 1
    ) {
      let def = variable.defs[0];
      if (def.type === 'Variable' && def.node.init) {
        return staticStringValue(def.node.init, null);
      }
    }
  }
  return null;
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    let found = current.variables.find((variable) => variable.name === name);
    if (found) {
      return found;
    }
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid pointing a realm iconURL or backgroundURL at an image host outside the allow-list',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedHosts: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      remoteRealmImage:
        'Realm {{property}} points at "{{host}}", which puts a host nobody here controls in the critical path of every Percy snapshot that renders this realm. Put the image in packages/host/public/test-fixtures/realm-images/ and use a root-relative URL, or use one of: {{allowed}}.',
    },
  },

  create(context) {
    let allowedHosts = new Set(
      context.options[0]?.allowedHosts ?? DEFAULT_ALLOWED_HOSTS,
    );
    let sourceCode = context.sourceCode ?? context.getSourceCode();

    return {
      Property(node) {
        let name = propertyKeyName(node);
        if (!name || !IMAGE_URL_PROPERTIES.has(name)) {
          return;
        }

        let scope = sourceCode.getScope
          ? sourceCode.getScope(node)
          : context.getScope();
        let value = staticStringValue(node.value, scope);
        if (typeof value !== 'string') {
          return;
        }
        // Browsers strip leading and trailing whitespace from a URL before
        // fetching it, so a stray space must not read as a local path here.
        value = value.trim();
        if (!REMOTE_URL.test(value)) {
          return;
        }

        // Normalised so the pattern above and `new URL` agree on what counts
        // as a separator. `new URL` also needs a scheme, and which one a
        // schemeless value would borrow does not change its host.
        let normalized = value.replace(/^((?:https?:)?)[/\\]{2}/i, '$1//');
        let host;
        try {
          host = new URL(
            normalized.startsWith('//') ? `https:${normalized}` : normalized,
          ).host;
        } catch {
          return;
        }
        if (allowedHosts.has(host)) {
          return;
        }

        context.report({
          node: node.value,
          messageId: 'remoteRealmImage',
          data: {
            property: name,
            host,
            allowed: [...allowedHosts].join(', '),
          },
        });
      },
    };
  },
};

'use strict';

// A pattern ending in `/*` names every module under that scope or path, and
// any other pattern names one module exactly.
function isRestricted(source, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith('/*')
      ? source.startsWith(pattern.slice(0, -1))
      : source === pattern,
  );
}

// The module a source node names, when it is written as a string.
function staticSource(node) {
  if (!node) {
    return undefined;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow loading a cloud provider SDK outside the modules that adapt it, by static import, re-export, dynamic `import()`, or `require()`',
      category: 'Architecture',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          patterns: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['patterns'],
        additionalProperties: false,
      },
    ],
    messages: {
      noCloudProviderSdk:
        "Load the cloud provider SDK '{{source}}' only in an adapter module (ADR 003 §1.2). Put the call behind an interface named for the capability, or add an adapter module to CLOUD_PROVIDER_ADAPTER_MODULES in eslint/cloud-provider-sdk-imports.cjs.",
    },
  },

  create(context) {
    let { patterns } = context.options[0] ?? { patterns: [] };

    function check(node, sourceNode) {
      let source = staticSource(sourceNode);
      if (source !== undefined && isRestricted(source, patterns)) {
        context.report({
          node,
          messageId: 'noCloudProviderSdk',
          data: { source },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source);
      },
      ExportAllDeclaration(node) {
        check(node, node.source);
      },
      ExportNamedDeclaration(node) {
        check(node, node.source);
      },
      ImportExpression(node) {
        check(node, node.source);
      },
      // `require('x')` and `require.resolve('x')`, whatever `require` is bound
      // to, so a `createRequire` result is caught too.
      CallExpression(node) {
        let { callee } = node;
        let isRequire =
          (callee.type === 'Identifier' && callee.name === 'require') ||
          (callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.object.name === 'require' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'resolve');
        if (isRequire) {
          check(node, node.arguments[0]);
        }
      },
      TSExternalModuleReference(node) {
        check(node, node.expression);
      },
    };
  },
};

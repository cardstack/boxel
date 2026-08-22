'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// `RealmIdentifier` and `RealmResourceIdentifier` are branded strings:
//
//   type RealmResourceIdentifier = string & { __rriBrand: unknown };
//
// so `new URL(identifier)` typechecks and throws only at runtime, and only for
// the canonical prefix form. The compiler cannot see the defect; a type-aware
// rule can, because the brand is a type.
const BRANDS = {
  __riBrand: 'RealmIdentifier',
  __rriBrand: 'RealmResourceIdentifier',
};

// Which brand, if any, a type carries. A branded string is an intersection, and
// a union can carry one in a single member, so both are walked.
// `getApparentType` covers a type parameter constrained to a branded string.
function brandOf(type, checker, seen = new Set()) {
  if (!type || seen.has(type)) {
    return undefined;
  }
  seen.add(type);
  for (const brand of Object.keys(BRANDS)) {
    if (type.getProperty ? type.getProperty(brand) : false) {
      return brand;
    }
  }
  for (const part of type.types || []) {
    const found = brandOf(part, checker, seen);
    if (found) {
      return found;
    }
  }
  const apparent = checker.getApparentType(type);
  if (apparent !== type) {
    return brandOf(apparent, checker, seen);
  }
  return undefined;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow constructing a URL from a realm identifier, which throws for the canonical prefix form',
      category: 'Possible Errors',
      recommended: false,
    },
    schema: [],
    messages: {
      urlFromIdentifier:
        '`new URL()` on a {{brand}} throws for a prefix-form identifier. Use `new RealmPaths(ri(x))` for path work, `virtualNetwork.toURL(x)` at a genuine network boundary, or ask the realm server which realm a URL belongs to. If this really is the boundary, disable this rule on the line with a reason.',
    },
  },

  create(context) {
    // Type information is only present where the config sets
    // `parserOptions.project`. Everywhere else this rule is inert rather than
    // wrong, so it can be enabled repo-wide and tightened per package.
    const services = context.sourceCode
      ? context.sourceCode.parserServices || context.parserServices
      : context.parserServices;
    if (!services || !services.program || !services.esTreeNodeToTSNodeMap) {
      return {};
    }
    const checker = services.program.getTypeChecker();

    return {
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'URL') {
          return;
        }
        const arg = node.arguments[0];
        if (!arg || arg.type === 'SpreadElement') {
          return;
        }
        const tsNode = services.esTreeNodeToTSNodeMap.get(arg);
        if (!tsNode) {
          return;
        }
        const brand = brandOf(checker.getTypeAtLocation(tsNode), checker);
        if (brand) {
          context.report({
            node,
            messageId: 'urlFromIdentifier',
            data: { brand: BRANDS[brand] },
          });
        }
      },
    };
  },
};

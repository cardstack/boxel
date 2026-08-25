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

// The empty string contributes no spelling of its own, so it does not fix the
// leading spelling of a concatenation.
function isEmptyStringLiteral(node) {
  return node && node.type === 'Literal' && node.value === '';
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
        '`new URL()` on a {{brand}} does not survive a prefix-form identifier: it throws with no base, and with one it resolves the prefix as a relative path into a URL that points nowhere. Use `new RealmPaths(ri(x))` for path work, `virtualNetwork.toURL(x)` at a genuine network boundary, or ask the realm server which realm a URL belongs to. If this really is the boundary, disable this rule on the line with a reason.',
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

    function typeBrandOf(node) {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      if (!tsNode) {
        return undefined;
      }
      return brandOf(checker.getTypeAtLocation(tsNode), checker);
    }

    // A branded string is a subtype of `string`, and TypeScript reduces
    // `RealmResourceIdentifier | string` to plain `string` — so a ternary
    // between an identifier and a template literal, or a concatenation with
    // one, has no brand left to find. The value is still an identifier at
    // runtime and `new URL` still throws on it, so the expression is walked
    // for a branded part rather than only asked for its own type.
    //
    // Only the forms that carry an identifier's spelling through are walked. A
    // branded operand of `===`, or a member of an array being indexed, does not
    // make the result an identifier.
    // Resolve a `const` binding to the expression it was initialized with, so
    // that computing the value into a local before parsing it does not hide the
    // identifier. Only single-definition `const`s are followed; anything
    // reassigned is not reliably the expression seen here.
    function constInitializerOf(node) {
      const sourceCode = context.sourceCode || context.getSourceCode();
      let scope = sourceCode.getScope
        ? sourceCode.getScope(node)
        : context.getScope();
      for (; scope; scope = scope.upper) {
        const variable = scope.set && scope.set.get(node.name);
        if (!variable) {
          continue;
        }
        if (variable.defs.length !== 1) {
          return undefined;
        }
        const def = variable.defs[0];
        if (
          def.type !== 'Variable' ||
          def.parent.kind !== 'const' ||
          !def.node.init
        ) {
          return undefined;
        }
        return def.node.init;
      }
      return undefined;
    }

    function brandInExpression(node, depth = 0) {
      if (!node || depth > 6) {
        return undefined;
      }
      const own = typeBrandOf(node);
      if (own) {
        return own;
      }
      switch (node.type) {
        case 'ConditionalExpression':
          return (
            brandInExpression(node.consequent, depth + 1) ||
            brandInExpression(node.alternate, depth + 1)
          );
        case 'LogicalExpression':
          return (
            brandInExpression(node.left, depth + 1) ||
            brandInExpression(node.right, depth + 1)
          );
        // Concatenation propagates the brand only from whatever fixes the
        // leading spelling. `${id}.gts` is still an identifier, but
        // `https://example.test/x/${id}` parses whatever `id` holds, so an
        // interpolation behind a literal prefix says nothing about the result.
        case 'BinaryExpression':
          if (node.operator !== '+') {
            return undefined;
          }
          return isEmptyStringLiteral(node.left)
            ? brandInExpression(node.right, depth + 1)
            : brandInExpression(node.left, depth + 1);
        case 'TemplateLiteral':
          return node.quasis.length > 0 && node.quasis[0].value.cooked !== ''
            ? undefined
            : brandInExpression(node.expressions[0], depth + 1);
        case 'Identifier': {
          const init = constInitializerOf(node);
          return init ? brandInExpression(init, depth + 1) : undefined;
        }
        case 'TSAsExpression':
        case 'TSNonNullExpression':
        case 'TSSatisfiesExpression':
          return brandInExpression(node.expression, depth + 1);
        default:
          return undefined;
      }
    }

    return {
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'URL') {
          return;
        }
        const arg = node.arguments[0];
        if (!arg || arg.type === 'SpreadElement') {
          return;
        }
        const brand = brandInExpression(arg);
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

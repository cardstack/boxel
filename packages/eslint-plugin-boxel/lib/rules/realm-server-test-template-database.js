'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Calls that bring up realms. On an empty test database each one indexes its
// realms from scratch, which is usually most of a realm-server test's time.
const REALM_STARTERS = new Set([
  'runTestRealmServer',
  'runTestRealmServerWithRealms',
  'setupPermissionedRealm',
  'setupPermissionedRealms',
]);

function propertyName(property) {
  if (property.type !== 'Property' || property.computed) {
    return undefined;
  }
  if (property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (property.key.type === 'Literal') {
    return String(property.key.value);
  }
  return undefined;
}

function isFunction(node) {
  return (
    node &&
    (node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression')
  );
}

// The function a variable names, when the same file declares it as a function
// declaration or as a variable initialized with a function. Imports,
// parameters and anything else resolve to nothing: the rule does not follow
// them.
function localFunctionOf(variable) {
  if (!variable) {
    return undefined;
  }
  for (const def of variable.defs) {
    if (def.type === 'FunctionName' && isFunction(def.node)) {
      return def.node;
    }
    if (
      def.type === 'Variable' &&
      def.node.type === 'VariableDeclarator' &&
      isFunction(def.node.init)
    ) {
      return def.node.init;
    }
  }
  return undefined;
}

function isImportedOrGlobal(variable) {
  return (
    !variable ||
    variable.defs.length === 0 ||
    variable.defs.some((def) => def.type === 'ImportBinding')
  );
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow a realm-server test module that brings up realms in `setupDB`’s `beforeEach` without a `templateDatabase`, which indexes them from scratch before every test',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      perTestIndex:
        "This module brings up realms in `setupDB`'s `beforeEach` (through `{{starter}}`) without a `templateDatabase`, so it indexes them from scratch before every test. For one realm, use `setupPermissionedRealmCached`. For realms each on their own server, use `setupPermissionedRealmsCached`. For realms on one server or a custom setup, use `setupTestDatabaseTemplate`. If the module tests the boot index itself, disable this rule on this line with a reason. See the realm-server-test-setup skill.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    // Every scope inside `fn`, including its own. Their references are every
    // identifier the function reads or calls, at any depth.
    function scopesWithin(fn) {
      const [start, end] = fn.range;
      return sourceCode.scopeManager.scopes.filter(
        (scope) => scope.block.range[0] >= start && scope.block.range[1] <= end,
      );
    }

    // The name of the first realm starter `fn` reaches, directly or through
    // functions declared in the same file, or undefined if it reaches none.
    function realmStarterReachedFrom(fn, visited = new Set()) {
      if (visited.has(fn)) {
        return undefined;
      }
      visited.add(fn);
      for (const scope of scopesWithin(fn)) {
        for (const reference of scope.references) {
          const name = reference.identifier.name;
          const variable = reference.resolved;
          if (REALM_STARTERS.has(name) && isImportedOrGlobal(variable)) {
            return name;
          }
          const local = localFunctionOf(variable);
          if (local) {
            const found = realmStarterReachedFrom(local, visited);
            if (found) {
              return found;
            }
          }
        }
      }
      return undefined;
    }

    // The function a `beforeEach` property holds: an inline function, or the
    // name of a function the same file declares.
    function hookFunction(value) {
      if (isFunction(value)) {
        return value;
      }
      if (value.type === 'Identifier') {
        const scope = sourceCode.getScope
          ? sourceCode.getScope(value)
          : context.getScope();
        const reference = findReference(scope, value);
        return localFunctionOf(reference && reference.resolved);
      }
      return undefined;
    }

    function findReference(scope, identifier) {
      for (let s = scope; s; s = s.upper) {
        const found = s.references.find((r) => r.identifier === identifier);
        if (found) {
          return found;
        }
      }
      return undefined;
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'setupDB'
        ) {
          return;
        }
        const options = node.arguments[1];
        if (!options || options.type !== 'ObjectExpression') {
          return;
        }
        // A spread could carry a `templateDatabase` the rule cannot see.
        if (options.properties.some((p) => p.type === 'SpreadElement')) {
          return;
        }
        if (
          options.properties.some((p) => propertyName(p) === 'templateDatabase')
        ) {
          return;
        }
        const beforeEach = options.properties.find(
          (p) => propertyName(p) === 'beforeEach',
        );
        if (!beforeEach) {
          return;
        }
        const fn = hookFunction(beforeEach.value);
        if (!fn) {
          return;
        }
        const starter = realmStarterReachedFrom(fn);
        if (starter) {
          context.report({
            node: beforeEach,
            messageId: 'perTestIndex',
            data: { starter },
          });
        }
      },
    };
  },
};

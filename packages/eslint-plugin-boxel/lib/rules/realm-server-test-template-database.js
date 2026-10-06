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

// The realm starter a reference names, if any. An import is matched by the name
// it imports, so an alias (`import { runTestRealmServer as start }`) and a
// namespace member (`helpers.runTestRealmServer`) both count. A name with no
// declaration in the file is matched as spelled. A local binding that shares a
// starter's name is not a starter.
function starterNamedBy(reference) {
  const identifier = reference.identifier;
  const variable = reference.resolved;
  if (!variable || variable.defs.length === 0) {
    return REALM_STARTERS.has(identifier.name) ? identifier.name : undefined;
  }
  for (const def of variable.defs) {
    if (def.type !== 'ImportBinding') {
      continue;
    }
    if (def.node.type === 'ImportSpecifier') {
      const imported = def.node.imported.name ?? def.node.imported.value;
      if (REALM_STARTERS.has(imported)) {
        return imported;
      }
    }
    if (def.node.type === 'ImportNamespaceSpecifier') {
      const member = identifier.parent;
      if (
        member &&
        member.type === 'MemberExpression' &&
        member.object === identifier &&
        !member.computed &&
        member.property.type === 'Identifier' &&
        REALM_STARTERS.has(member.property.name)
      ) {
        return member.property.name;
      }
    }
  }
  return undefined;
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
    // identifier the function reads or calls, at any depth. A starter in a
    // nested callback counts even though the rule cannot prove the callback
    // runs: setup usually runs its callbacks (`Promise.all(realms.map(...))`, a
    // retry wrapper), and a module that does not can disable the rule.
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
          const starter = starterNamedBy(reference);
          if (starter) {
            return starter;
          }
          const local = localFunctionOf(reference.resolved);
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

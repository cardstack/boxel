'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Calls that bring up realms. On an empty test database each one indexes its
// realms from scratch, which is usually most of a realm-server test's time.
const REALM_STARTERS = new Set([
  'runTestRealmServer',
  'runTestRealmServerWithRealms',
]);

// Calls that build a realm without starting it. The realm indexes when its
// `start()` runs, so a `start()` on one of these realms counts as a starter.
const REALM_FACTORIES = new Set(['createRealm']);

const SETUP_DB = new Set(['setupDB']);

// Setup helpers that register their own `setupDB` hooks. Without
// `mode: 'before'` they bring up their realms before every test, on a database
// with no template.
const UNCACHED_SETUPS = new Set([
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

// `templateDatabase: undefined` passes no template, so it counts as absent.
function isUndefined(node) {
  return (
    (node.type === 'Identifier' && node.name === 'undefined') ||
    (node.type === 'UnaryExpression' && node.operator === 'void')
  );
}

// Whether a reference sits in a type position, such as
// `ReturnType<typeof runTestRealmServer>`. A type never runs.
function isTypeOnly(reference) {
  if (reference.isTypeReference && !reference.isValueReference) {
    return true;
  }
  for (let node = reference.identifier.parent; node; node = node.parent) {
    if (
      node.type === 'TSTypeQuery' ||
      node.type === 'TSTypeAnnotation' ||
      node.type === 'TSTypeReference'
    ) {
      return true;
    }
    if (isFunction(node)) {
      return false;
    }
  }
  return false;
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

// The helper in `names` a reference names, if any. An import is matched by the
// name it imports, so an alias (`import { runTestRealmServer as start }`) and a
// namespace member (`helpers.runTestRealmServer`) both count. A name with no
// declaration in the file is matched as spelled. A local binding that shares a
// helper's name is not the helper.
function helperNamedBy(reference, names) {
  const identifier = reference.identifier;
  const variable = reference.resolved;
  if (!variable || variable.defs.length === 0) {
    return names.has(identifier.name) ? identifier.name : undefined;
  }
  for (const def of variable.defs) {
    if (def.type !== 'ImportBinding') {
      continue;
    }
    if (def.node.type === 'ImportSpecifier') {
      const imported = def.node.imported.name ?? def.node.imported.value;
      if (names.has(imported)) {
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
        names.has(member.property.name)
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
        'Disallow a realm-server test module that brings up realms before every test without a template database, which indexes them from scratch each time',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      perTestIndex:
        "This module brings up realms in `setupDB`'s `beforeEach` (through `{{starter}}`) without a `templateDatabase`, so it indexes them from scratch before every test. For one realm, use `setupPermissionedRealmCached`. For realms each on their own server, use `setupPermissionedRealmsCached`. For realms on one server or a custom setup, use `setupTestDatabaseTemplate`. If the module tests the boot index itself, disable this rule on this line with a reason. See the realm-server-test-setup skill.",
      uncachedSetup:
        '`{{helper}}` brings up its realms before every test without a template database, so it indexes them from scratch each time. Use `{{helper}}Cached`, which indexes once per module and starts each test from a copy. If the module tests the boot index itself, disable this rule on this line with a reason. See the realm-server-test-setup skill.',
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

    // The factory that built the realm, when a reference is the object of a
    // `.start()` call on a realm some factory returned:
    // `({ realm } = await createRealm(...))` and later `realm.start()`.
    function startedRealmFactory(reference) {
      const member = reference.identifier.parent;
      if (
        !member ||
        member.type !== 'MemberExpression' ||
        member.object !== reference.identifier ||
        member.computed ||
        member.property.type !== 'Identifier' ||
        member.property.name !== 'start' ||
        !member.parent ||
        member.parent.type !== 'CallExpression' ||
        member.parent.callee !== member
      ) {
        return undefined;
      }
      const variable = reference.resolved;
      if (!variable) {
        return undefined;
      }
      for (const write of variable.references) {
        let value = write.writeExpr;
        while (value && value.type === 'AwaitExpression') {
          value = value.argument;
        }
        if (value && value.type === 'CallExpression') {
          const factory = helperCalledBy(value, REALM_FACTORIES);
          if (factory) {
            return factory;
          }
        }
      }
      return undefined;
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
          if (isTypeOnly(reference)) {
            continue;
          }
          const starter =
            helperNamedBy(reference, REALM_STARTERS) ??
            startedRealmFactory(reference);
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
        const reference = findReference(scopeOf(value), value);
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

    function scopeOf(node) {
      return sourceCode.getScope
        ? sourceCode.getScope(node)
        : context.getScope();
    }

    // The helper in `names` a call invokes, if any: `helper(...)`,
    // `alias(...)` or `namespace.helper(...)`.
    function helperCalledBy(node, names) {
      const callee = node.callee;
      let identifier;
      if (callee.type === 'Identifier') {
        identifier = callee;
      } else if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier'
      ) {
        identifier = callee.object;
      } else {
        return undefined;
      }
      const reference = findReference(scopeOf(node), identifier);
      return reference && helperNamedBy(reference, names);
    }

    // Reports a call to an uncached setup helper unless its options say
    // `mode: 'before'` or carry a template. Options the rule cannot read (not
    // an object literal, a spread, a `mode` that is not a string literal) are
    // left alone.
    function checkUncachedSetup(node, helper) {
      const options = node.arguments[1];
      if (!options || options.type !== 'ObjectExpression') {
        return;
      }
      if (options.properties.some((p) => p.type === 'SpreadElement')) {
        return;
      }
      if (
        options.properties.some((p) => propertyName(p) === 'dbTemplateDatabase')
      ) {
        return;
      }
      const mode = options.properties.find((p) => propertyName(p) === 'mode');
      if (mode) {
        if (mode.value.type !== 'Literal') {
          return;
        }
        if (mode.value.value !== 'beforeEach') {
          return;
        }
      }
      context.report({
        node: node.callee,
        messageId: 'uncachedSetup',
        data: { helper },
      });
    }

    return {
      CallExpression(node) {
        const helper = helperCalledBy(node, UNCACHED_SETUPS);
        if (helper) {
          checkUncachedSetup(node, helper);
          return;
        }
        if (!helperCalledBy(node, SETUP_DB)) {
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
        // Only the presence of a template is checked, not what it holds.
        if (
          options.properties.some(
            (p) =>
              propertyName(p) === 'templateDatabase' && !isUndefined(p.value),
          )
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

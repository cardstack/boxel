'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// `test`, and the QUnit variants that also take a test body.
const TEST_CALLEES = new Set(['test', 'skip', 'todo', 'only']);

// Stands in for the name Percy will derive when this file doesn't spell out
// enough of it to reconstruct — a module or test named by something other than
// a static string. Two bare calls in such a test still collide with each other,
// which this catches; they just can't be compared against a written-out name.
const DERIVED = Symbol('derived from module and test name');

// A name that cannot be known statically. Never compared, never recorded — a
// call the rule has no opinion about is not a call it may report.
const UNKNOWN = Symbol('not statically known');

// `test(...)`, `test.only(...)`, `module(...)` all answer with the leading
// identifier. `re.test(s)` answers 're', so a method call named `test` on some
// other object is not mistaken for a QUnit test.
function calleeRootName(node) {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier'
  ) {
    return callee.object.name;
  }
  return null;
}

function staticString(node) {
  if (!node) {
    return null;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function callbackOf(node) {
  return node.arguments.find(
    (a) =>
      a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression',
  );
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every Percy snapshot within a test to have a distinct name',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      duplicateDerivedName:
        'This test already takes a Percy snapshot under the name Percy derives from its module and test name, and Percy keeps one snapshot per name per build. Pass an explicit distinct name here so both snapshots are reviewed.',
      duplicateExplicitName:
        "Another Percy snapshot in this test already takes the name '{{name}}', and Percy keeps one snapshot per name per build. Give this one a distinct name so both snapshots are reviewed.",
    },
  },

  create(context) {
    // Enclosing `module()` names, outermost first. QUnit joins nested module
    // names with ' > ' to form the module name Percy reads.
    let moduleNames = [];
    // One frame per enclosing test call: the names taken so far, the name
    // Percy will derive for it, and what its callback calls the assert object.
    let testStack = [];

    function derivedNameFor(testName) {
      if (testName === null || moduleNames.length === 0) {
        return null;
      }
      if (moduleNames.some((m) => m === null)) {
        return null;
      }
      return `${moduleNames.join(' > ')} | ${testName}`;
    }

    // Whether this call lets Percy derive its name rather than spelling one out.
    function letsPercyDerive(node, frame) {
      const [arg] = node.arguments;
      return (
        !arg ||
        (arg.type === 'Identifier' &&
          (arg.name === frame.assertParam || arg.name === 'assert'))
      );
    }

    // What name this call will upload under: a written-out string, the name
    // Percy derives for the enclosing test, or UNKNOWN when the argument is
    // computed. Both spellings of the derived name land on the same key, so
    // `percySnapshot(assert)` and a literal equal to that derived name are
    // recognised as the collision they are.
    function keyFor(node, frame) {
      if (letsPercyDerive(node, frame)) {
        return frame.derived === null ? DERIVED : frame.derived;
      }
      const written = staticString(node.arguments[0]);
      return written === null ? UNKNOWN : written;
    }

    return {
      CallExpression(node) {
        const root = calleeRootName(node);

        if (root === 'module') {
          moduleNames.push(staticString(node.arguments[0]));
          return;
        }

        if (TEST_CALLEES.has(root)) {
          const callback = callbackOf(node);
          const firstParam = callback && callback.params[0];
          testStack.push({
            taken: new Map(),
            derived: derivedNameFor(staticString(node.arguments[0])),
            assertParam:
              firstParam && firstParam.type === 'Identifier'
                ? firstParam.name
                : null,
          });
          return;
        }

        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'percySnapshot'
        ) {
          return;
        }

        const frame = testStack[testStack.length - 1];
        // A call outside any test can't collide with a sibling call.
        if (!frame) {
          return;
        }

        const key = keyFor(node, frame);
        if (key === UNKNOWN) {
          return;
        }

        if (frame.taken.has(key)) {
          context.report({
            node,
            messageId: letsPercyDerive(node, frame)
              ? 'duplicateDerivedName'
              : 'duplicateExplicitName',
            data: { name: typeof key === 'string' ? key : '' },
          });
          return;
        }

        frame.taken.set(key, node);
      },

      'CallExpression:exit'(node) {
        const root = calleeRootName(node);
        if (root === 'module') {
          moduleNames.pop();
        } else if (TEST_CALLEES.has(root)) {
          testStack.pop();
        }
      },
    };
  },
};

'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// `test`, and the QUnit variants that also take a test body.
const TEST_CALLEES = new Set(['test', 'skip', 'todo', 'only']);

// Stands in for the name `percySnapshot(assert)` produces, which is the QUnit
// module name plus the test name and nothing else — identical for every bare
// call within one test.
const DERIVED_NAME = Symbol('derived from module and test name');

function testCalleeName(node) {
  let callee = node.callee;
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  // test.only(...), test.skip(...)
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier'
  ) {
    return callee.object.name;
  }
  return null;
}

function isTestCall(node) {
  return TEST_CALLEES.has(testCalleeName(node));
}

// The explicit name a call passes, or null when Percy will derive one.
function explicitName(node) {
  let [arg] = node.arguments;
  if (!arg) {
    return null;
  }
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    return arg.value;
  }
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
    return arg.quasis[0].value.cooked;
  }
  return null;
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
        'This test already takes a Percy snapshot under the name derived from its module and test name, and Percy keeps one snapshot per name per build. Pass an explicit distinct name here so both snapshots are reviewed.',
      duplicateExplicitName:
        "Another Percy snapshot in this test is already named '{{name}}', and Percy keeps one snapshot per name per build. Give this one a distinct name so both snapshots are reviewed.",
    },
  },

  create(context) {
    // One entry per enclosing test call, holding the names taken so far.
    let testStack = [];

    return {
      CallExpression(node) {
        if (isTestCall(node)) {
          testStack.push(new Map());
          return;
        }
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'percySnapshot'
        ) {
          return;
        }
        let taken = testStack[testStack.length - 1];
        // A call outside any test can't collide with a sibling call.
        if (!taken) {
          return;
        }
        let name = explicitName(node);
        let key = name === null ? DERIVED_NAME : name;
        if (taken.has(key)) {
          context.report({
            node,
            messageId:
              name === null ? 'duplicateDerivedName' : 'duplicateExplicitName',
            data: { name },
          });
          return;
        }
        taken.set(key, node);
      },

      'CallExpression:exit'(node) {
        if (isTestCall(node)) {
          testStack.pop();
        }
      },
    };
  },
};

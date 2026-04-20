/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow `requestAnimationFrame` in Ember component files — use `scheduleOnce("afterRender", ...)` from `@ember/runloop` instead so that `settled()` in tests can track the work',
      category: 'Testing',
      recommended: false,
    },
    schema: [],
    messages: {
      noRafForState:
        'Avoid `requestAnimationFrame` in Ember components. It runs outside the Ember runloop, so `settled()` and test helpers cannot wait for it, causing flaky tests. Use `scheduleOnce("afterRender", ...)` from `@ember/runloop` instead. If you genuinely need a paint callback (e.g. canvas, animation loop), disable this rule with an inline comment.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'requestAnimationFrame'
        ) {
          context.report({
            node,
            messageId: 'noRafForState',
          });
        }

        // Also catch window.requestAnimationFrame
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'window' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'requestAnimationFrame'
        ) {
          context.report({
            node,
            messageId: 'noRafForState',
          });
        }
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow `position: fixed` in card CSS because cards should not break out of their bounding box',
      category: 'Ember Octane',
      recommended: true,
    },
    schema: [],
    messages: {
      'no-css-position-fixed':
        'Do not use `position: fixed` in card CSS. Cards should not break out of their bounding box. Consider using `position: absolute` or `position: sticky` instead.',
    },
  },

  create: (context) => {
    return {
      GlimmerElementNode(node) {
        if (node.tag !== 'style') {
          return;
        }
        for (const child of node.children) {
          if (child.type === 'GlimmerTextNode') {
            const text = child.value;
            const regex = /position\s*:\s*fixed/gi;
            let match;
            while ((match = regex.exec(text)) !== null) {
              context.report({
                node: child,
                messageId: 'no-css-position-fixed',
              });
            }
          }
        }
      },
    };
  },
};

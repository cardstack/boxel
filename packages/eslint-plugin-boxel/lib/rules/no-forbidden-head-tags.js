const ALLOWED_HEAD_TAGS = new Set(['title', 'meta', 'link', 'template']);

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow forbidden HTML elements in `static head` templates — only `<title>`, `<meta>`, and `<link>` are permitted',
      category: 'Ember Octane',
      recommended: true,
    },
    schema: [],
    messages: {
      'no-forbidden-head-tags':
        '`<{{ tag }}>` is not allowed in a head template. Only `<title>`, `<meta>`, and `<link>` are permitted. Disallowed tags will be stripped when rendering.',
    },
  },

  create(context) {
    let insideHeadTemplate = false;

    return {
      'PropertyDefinition[static=true][key.name="head"]'() {
        insideHeadTemplate = true;
      },
      'PropertyDefinition[static=true][key.name="head"]:exit'() {
        insideHeadTemplate = false;
      },
      GlimmerElementNode(node) {
        if (!insideHeadTemplate) {
          return;
        }
        let tag = node.tag;
        if (!ALLOWED_HEAD_TAGS.has(tag)) {
          context.report({
            node,
            messageId: 'no-forbidden-head-tags',
            data: { tag },
          });
        }
      },
    };
  },
};

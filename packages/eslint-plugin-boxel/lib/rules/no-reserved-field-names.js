// Property names card-api provides as system getters on CardDef/FileDef. A
// userland `@field` under one of these shadows the getter via the prototype
// chain; card-api's `field` decorator refuses them at runtime, and this rule
// is the authoring-time backstop. Keep in sync with `RESERVED_FIELD_NAMES`
// in packages/base/card-api.gts.
const RESERVED_FIELD_NAMES = ['screenshotURLs', 'screenshotsMeta'];

function isFieldDecorator(decorator) {
  let expression = decorator.expression;
  if (!expression) {
    return false;
  }
  if (expression.type === 'Identifier') {
    return expression.name === 'field';
  }
  if (
    expression.type === 'CallExpression' &&
    expression.callee.type === 'Identifier'
  ) {
    return expression.callee.name === 'field';
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow `@field` declarations under names the system reserves for its own getters (e.g. `screenshotURLs`)',
      category: 'Ember Octane',
      url: 'https://github.com/cardstack/boxel/blob/main/packages/eslint-plugin-boxel/docs/rules/no-reserved-field-names.md',
      recommended: true,
    },
    schema: [],
    messages: {
      'no-reserved-field-names':
        '"{{name}}" is a reserved name: it is provided by the system as a getter on CardDef/FileDef and cannot be declared as a field',
    },
  },

  create: (context) => {
    function checkClassMember(node) {
      let name;
      if (node.key.type === 'Identifier') {
        name = node.key.name;
      } else if (
        node.key.type === 'Literal' &&
        typeof node.key.value === 'string'
      ) {
        name = node.key.value;
      } else {
        return;
      }
      if (!RESERVED_FIELD_NAMES.includes(name)) {
        return;
      }
      if (!(node.decorators ?? []).some(isFieldDecorator)) {
        return;
      }
      context.report({
        node: node.key,
        messageId: 'no-reserved-field-names',
        data: { name },
      });
    }
    return {
      PropertyDefinition: checkClassMember,
      // Some parser configurations emit legacy ClassProperty nodes.
      ClassProperty: checkClassMember,
    };
  },
};

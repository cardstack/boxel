const DOM_EXISTS_SELECTOR =
  'CallExpression' +
  '[callee.type="MemberExpression"]' +
  '[callee.object.type="CallExpression"]' +
  '[callee.object.callee.type="MemberExpression"]' +
  '[callee.object.callee.object.name="assert"]' +
  '[callee.object.callee.property.name="dom"]' +
  '[callee.property.name=/^(exists|doesNotExist)$/]';

const OK_OR_NOTOK_SELECTOR =
  'CallExpression' +
  '[callee.type="MemberExpression"]' +
  '[callee.object.name="assert"]' +
  '[callee.property.name=/^(ok|notOk)$/]' +
  '[arguments.length>=1]';

const EQUAL_SELECTOR =
  'CallExpression' +
  '[callee.type="MemberExpression"]' +
  '[callee.object.name="assert"]' +
  '[callee.property.name="equal"]' +
  '[arguments.length>=2]' +
  '[arguments.1.type="Literal"]';

const EQUAL_LENGTH_SELECTOR =
  'CallExpression' +
  '[callee.type="MemberExpression"]' +
  '[callee.object.name="assert"]' +
  '[callee.property.name=/^(equal|strictEqual)$/]' +
  '[arguments.length>=2]' +
  '[arguments.0.type="MemberExpression"]' +
  '[arguments.0.object.type="CallExpression"]' +
  '[arguments.0.object.callee.type="Identifier"]' +
  '[arguments.0.object.callee.name="find"]' +
  '[arguments.0.property.type="Identifier"]' +
  '[arguments.0.property.name="length"]' +
  '[arguments.1.type="Literal"]';

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: "disallow use of `assert.dom('.foo:checked').exists()`",
      recommended: true,
      url: 'https://github.com/Mainmatter/eslint-plugin-qunit-dom/blob/main/rules/no-checked-selector.md',
    },
    fixable: 'code',
    schema: [],
    messages: {
      default: 'use assert.dom(...).isChecked()',
      inverted: 'use assert.dom(...).isNotChecked()',
    },
  },

  create(context) {
    let sourceCode = context.getSourceCode();

    function fix(fixer, node, { inverted, target, rootElement, message }) {
      let targetText = sourceCode.getText(target);

      let domArgs = targetText.substring(0, targetText.length - ':checked'.length - 1);
      domArgs += targetText.substring(targetText.length - 1);
      if (rootElement) {
        domArgs += ', ';
        domArgs += sourceCode.getText(rootElement);
      }

      let assertion = inverted ? 'isNotChecked' : 'isChecked';

      let messageText = message ? sourceCode.getText(message) : '';

      return fixer.replaceText(node, `assert.dom(${domArgs}).${assertion}(${messageText})`);
    }

    return {
      [DOM_EXISTS_SELECTOR](node) {
        let inverted = node.callee.property.name === 'doesNotExist';

        let target = node.callee.object.arguments[0];
        if (!isValidFindArg(target)) return;

        context.report({
          node: node,
          messageId: inverted ? 'inverted' : 'default',

          fix(fixer) {
            let rootElement = node.callee.object.arguments[1];
            let message = node.arguments[0];
            return fix(fixer, node, { inverted, target, rootElement, message });
          },
        });
      },

      [OK_OR_NOTOK_SELECTOR](node) {
        let inverted = node.callee.property.name === 'notOk';

        let firstArg = node.arguments[0];
        if (!isFindCall(firstArg) && !isIndexedFindCall(firstArg)) return;

        let findNode = firstArg.type === 'MemberExpression' ? firstArg.object : firstArg;
        let target = findNode.arguments[0];
        if (!isValidFindArg(target)) return;

        context.report({
          node: node,
          messageId: inverted ? 'inverted' : 'default',

          fix(fixer) {
            let rootElement = findNode.arguments[1];
            let message = node.arguments[1];
            return fix(fixer, node, { inverted, target, rootElement, message });
          },
        });
      },

      [EQUAL_SELECTOR](node) {
        let secondArg = node.arguments[1];
        if (typeof secondArg.value !== 'boolean') return;
        let inverted = !secondArg.value;

        let firstArg = node.arguments[0];
        if (!isFindCall(firstArg) && !isIndexedFindCall(firstArg)) return;

        let findNode = firstArg.type === 'MemberExpression' ? firstArg.object : firstArg;
        let target = findNode.arguments[0];
        if (!isValidFindArg(target)) return;

        context.report({
          node: node,
          messageId: inverted ? 'inverted' : 'default',

          fix(fixer) {
            let rootElement = findNode.arguments[1];
            let message = node.arguments[2];
            return fix(fixer, node, { inverted, target, rootElement, message });
          },
        });
      },

      [EQUAL_LENGTH_SELECTOR](node) {
        let secondArg = node.arguments[1];
        let inverted = secondArg.value === 0;

        let findNode = node.arguments[0].object;
        let target = findNode.arguments[0];
        if (!isValidFindArg(target)) return;

        context.report({
          node: node,
          messageId: inverted ? 'inverted' : 'default',

          fix(fixer) {
            let rootElement = findNode.arguments[1];
            let message = node.arguments[2];
            return fix(fixer, node, { inverted, target, rootElement, message });
          },
        });
      },
    };
  },
};

// checks for `find(...)`
function isFindCall(node) {
  return node.type === 'CallExpression' && node.callee.name === 'find';
}

// checks for `find(...)[0]`
function isIndexedFindCall(node) {
  return (
    node.type === 'MemberExpression' &&
    isFindCall(node.object) &&
    node.property.type === 'Literal' &&
    node.property.value === 0
  );
}

function isValidFindArg(node) {
  return (
    node &&
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    node.value !== ':checked' &&
    node.value.endsWith(':checked')
  );
}

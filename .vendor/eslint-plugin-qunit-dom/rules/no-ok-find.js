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

// see https://api.jquery.com/category/selectors/jquery-selector-extensions/
const JQUERY_SELECTOR_EXTENSIONS = [
  ':animated',
  ':button',
  ':checkbox',
  ':contains(',
  ':eq(',
  ':even',
  ':file',
  ':first',
  ':gt(',
  ':has(',
  ':header',
  ':hidden',
  ':image',
  ':input',
  ':last',
  ':lt(',
  ':odd',
  ':parent',
  ':password',
  ':radio',
  ':reset',
  ':selected',
  ':submit',
  ':text',
  ':visible',
];

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow use of `assert.ok(find(...))`',
      recommended: true,
      url: 'https://github.com/Mainmatter/eslint-plugin-qunit-dom/blob/main/rules/no-ok-find.md',
    },
    fixable: 'code',
    schema: [],
    messages: {
      default: 'use assert.dom(...).exists()',
      inverted: 'use assert.dom(...).doesNotExists()',
    },
  },

  create(context) {
    let sourceCode = context.getSourceCode();

    function fix(fixer, node, { inverted, findNode, messageNode }) {
      let domArgs = sourceCode.getText(findNode.arguments[0]);
      let scopeArg = findNode.arguments[1];
      if (scopeArg) {
        domArgs += ', ';
        domArgs += sourceCode.getText(scopeArg);
      }

      let assertion = inverted ? 'doesNotExist' : 'exists';

      let messageArgText = messageNode ? sourceCode.getText(messageNode) : '';

      return fixer.replaceText(node, `assert.dom(${domArgs}).${assertion}(${messageArgText})`);
    }

    return {
      [OK_OR_NOTOK_SELECTOR](node) {
        let inverted = node.callee.property.name === 'notOk';

        let firstArg = node.arguments[0];
        if (!isFindCall(firstArg) && !isIndexedFindCall(firstArg)) return;

        let findNode = firstArg.type === 'MemberExpression' ? firstArg.object : firstArg;
        let firstFindArg = findNode.arguments[0];
        if (!isValidFindArg(firstFindArg)) return;

        context.report({
          node: node,
          messageId: inverted ? 'inverted' : 'default',

          fix(fixer) {
            let messageNode = node.arguments[1];
            return fix(fixer, node, { inverted, findNode, messageNode });
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
        let findArgs = findNode.arguments;
        let firstFindArg = findArgs[0];
        if (!isValidFindArg(firstFindArg)) return;

        context.report({
          node: node,
          messageId: inverted ? 'inverted' : 'default',

          fix(fixer) {
            let messageNode = node.arguments[2];
            return fix(fixer, node, { inverted, findNode, messageNode });
          },
        });
      },

      [EQUAL_LENGTH_SELECTOR](node) {
        let secondArg = node.arguments[1];
        let inverted = secondArg.value === 0;

        let findNode = node.arguments[0].object;
        let firstFindArg = findNode.arguments[0];
        if (!isValidFindArg(firstFindArg)) return;

        context.report({
          node: node,
          messageId: inverted ? 'inverted' : 'default',

          fix(fixer) {
            let messageNode = node.arguments[2];
            return fix(fixer, node, { inverted, findNode, messageNode });
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
  if (!node) return false;
  if (node.type === 'Literal') {
    return typeof node.value === 'string' && !hasJQuerySelector(node.value);
  }
  return true;
}

function hasJQuerySelector(selector) {
  return JQUERY_SELECTOR_EXTENSIONS.some(it => selector.includes(it));
}

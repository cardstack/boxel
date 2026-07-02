# eslint-plugin-qunit-dom

An ESLint plugin for [qunit-dom] that automatically fixes the most common issues.

[qunit-dom]: https://github.com/Mainmatter/qunit-dom

## Compatibility

- [ESLint](https://eslint.org/) 7.0.0 or above
- [Node.js](https://nodejs.org/) 12.x or above

## Installation

```shell
yarn add --dev eslint-plugin-qunit-dom
```

Or

```shell
npm install --save-dev eslint-plugin-qunit-dom
```

## Usage

Modify your `.eslintrc.js` by adding the `plugin:qunit-dom/recommended` config
to the `extends` list:

```js
// .eslintrc.js
module.exports = {
  extends: [
    // ...
    'plugin:qunit-dom/recommended',
  ],
};
```

## Rules

<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
✅ Set in the `recommended` configuration.\
🔧 Automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).

| Name                                                | Description                                           | 💼  | 🔧  |
| :-------------------------------------------------- | :---------------------------------------------------- | :-- | :-- |
| [no-checked-selector](rules/no-checked-selector.md) | disallow use of `assert.dom('.foo:checked').exists()` | ✅  | 🔧  |
| [no-ok-find](rules/no-ok-find.md)                   | disallow use of `assert.ok(find(...))`                | ✅  | 🔧  |
| [require-assertion](rules/require-assertion.md)     | require at least one assertion on `assert.dom()`      | ✅  | 🔧  |

<!-- end auto-generated rules list -->

## License

This project is developed by and &copy; [Mainmatter GmbH](http://mainmatter.com)
and contributors. It is released under the [MIT License](./LICENSE).

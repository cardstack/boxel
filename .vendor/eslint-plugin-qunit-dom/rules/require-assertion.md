# require-assertion

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

At least one assertion should be made after calling `assert.dom()`.

## Examples

This rule **forbids** the following:

```js
assert.dom('.foo');
```

This rule **allows** the following:

```js
assert.dom('.foo').exists();
```

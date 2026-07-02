# no-checked-selector

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

The `isChecked()` and `isNotChecked()` assertions should be preferred over
using the `:checked` CSS selector.

## Examples

This rule **forbids** the following:

```js
assert.dom('.foo:checked').exists();
```

This rule **allows** the following:

```js
assert.dom('.foo').isChecked();
```

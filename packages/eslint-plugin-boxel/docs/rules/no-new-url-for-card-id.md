# Disallow `new URL()` on card/module identifiers that may be in prefix form; use `cardIdToURL()` instead (`@cardstack/boxel/no-new-url-for-card-id`)

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Disallow `new URL()` on card/module identifiers that may be in prefix form; use `cardIdToURL()` instead.

Card and module identifiers can be in prefix form (e.g. `@cardstack/base/card-api`) which is not a valid URL. Passing these to `new URL()` throws `TypeError: Invalid URL`. Use `cardIdToURL()` from `@cardstack/runtime-common` which resolves prefix-form identifiers through the import map before creating a URL.

## Examples

### Invalid

```js
let url = new URL(cardId);
let url = new URL(ref.module);
let url = new URL(spec.id);
let url = new URL(moduleIdentifier);
```

### Valid

```js
let url = cardIdToURL(cardId);
let url = cardIdToURL(ref.module);
let url = cardIdToURL(spec.id);

// Two-argument form is fine (relative URL resolution)
let url = new URL(path, baseURL);

// String literal URLs are fine
let url = new URL('https://example.com');

// Variables that are always HTTP URLs are fine
let url = new URL(realmURL);
let url = new URL(response.url);
```

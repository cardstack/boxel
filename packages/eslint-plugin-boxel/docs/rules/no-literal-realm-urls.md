# Disallow environment-specific realm URLs in code; use the registered prefixes like @cardstack/catalog/ instead (`@cardstack/boxel/no-literal-realm-urls`)

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

A realm addressed by a registered `@cardstack/<realm>/` prefix should be
written as that prefix, not as the URL one environment serves it at. By default
the rule flags every registered prefix realm (`base`, `catalog`, `skills`,
`openrouter`, `pretui`) at each origin a realm server is reached at:
`http(s)://localhost:4201`, `https://realms-staging.stack.cards`,
`https://app.boxel.ai`, and environment-mode `realm-server.<env>.localhost`
hosts with or without a port.

The prefixes come from `lib/utils/prefix-realms.js`, which a plugin test keeps
equal to `PREFIX_REALMS` in `packages/runtime-common/realm-prefixes.ts`.

The base realm's `https://cardstack.com/base/` alias is not flagged here: it is a
fetch target in its own right. `no-url-form-base-imports` covers it in import
positions.

## Examples

Incorrect:

```js
let id = 'http://localhost:4201/skills/boxel-environment';
```

Correct:

```js
let id = '@cardstack/skills/boxel-environment';
```

## Options

### `realmMappings`

Replaces the default table. Array of realm mapping objects, each with:

- `prefix` (string) — the portable prefix (e.g. `@cardstack/catalog/`)
- `urls` (string[]) — environment-specific URLs to replace
- `patterns` (string[], optional) — regex patterns for dynamic URLs

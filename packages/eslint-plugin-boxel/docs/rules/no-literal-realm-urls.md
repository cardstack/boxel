# Disallow environment-specific realm URLs in code; use portable prefixes like @cardstack/catalog/ instead (`@cardstack/boxel/no-literal-realm-urls`)

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Disallow environment-specific realm URLs in code; use portable prefixes like @cardstack/catalog/ instead.

## Options

### `realmMappings`

Array of realm mapping objects, each with:

- `prefix` (string) — the portable prefix (e.g. `@cardstack/catalog/`)
- `urls` (string[]) — environment-specific URLs to replace
- `patterns` (string[], optional) — regex patterns for dynamic URLs

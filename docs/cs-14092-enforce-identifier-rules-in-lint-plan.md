# Enforce the realm-identifier rules in lint

## Goal

Make the existing `@cardstack/boxel` lint rules cover the identifier rules
that are delegated to them, so URL-form base imports and environment-specific
realm URLs cannot come back unnoticed.

## Steps

1. `no-url-form-base-imports`
   - Read a template-literal specifier by its leading spelling: the text before
     the first interpolation, or a string literal interpolated first
     (`` `${'https://cardstack.com/base/'}x` ``). Autofix both.
   - Read the specifier `importResource(this, () => '…')` returns.
   - Enable it for `packages/runtime-common` (`**/*.ts`, `etc/**/*.js`) and for
     `packages/base` `**/*.ts` (`.gts` already had it through `recommended`).
   - Add a minimal ESLint setup to `packages/pretui` and
     `packages/experiments-realm` that runs only this rule, and autofix their
     hits. `experiments-realm/filedef-fixtures/samples/` is byte-exact sample
     content served as files, so it is ignored rather than rewritten.
2. `no-literal-realm-urls`
   - Build the default table from the registered prefixes
     (`lib/utils/prefix-realms.js`) at every realm-server origin:
     `http(s)://localhost:4201`, `https://realms-staging.stack.cards`,
     `https://app.boxel.ai`, and `realm-server.<env>.localhost`. The base alias
     `https://cardstack.com/base/` is not mapped.
   - The plugin is CommonJS and `realm-prefixes.ts` is TypeScript importing
     TypeScript, so the prefix list is restated in the plugin and a plugin test
     fails when it drifts from `PREFIX_REALMS`.
   - Enable it on host `app/**`, runtime-common source and base. Tests are left
     out: they spell environment URLs on purpose to test resolution.
3. `no-url-from-realm-identifier`
   - Lead the messages with `virtualNetwork.fetch(x)`; disable only where a
     guard on the same path admits only URL form, naming that guard (a `catch`
     is not one).
   - Drop the "enable it repo-wide/broadly" wording; update the docs example
     and host's cited count of test hits.
4. Plugin tests for each of the above, including `URL.parse(x, rriBase)`.

## Out of scope

- The type-aware rule in `packages/base`.
- Alias imports in the `test-realm-cards` fixture realm.
- Alias spellings in non-import positions, such as a code ref's `module`.

## Testing

- `pnpm test` and `pnpm lint` in `packages/eslint-plugin-boxel`.
- `pnpm lint` in runtime-common, base, pretui and experiments-realm; host
  `pnpm lint:js`.
- pretui `lint:types`; experiments-realm `ember-tsc` shows no errors in the
  autofixed files.

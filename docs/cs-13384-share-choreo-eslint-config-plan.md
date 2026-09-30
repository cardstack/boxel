# CS-13384: Share one eslint base config across the Choreo packages

## Goal

The four Choreo packages (glimmer-motion, choreo-player, choreo-gallery,
choreo-test-app) each carry a ~130-line `eslint.config.mjs` that differs only in
its ignores and a few overrides. Move the common config into one module so each
package's config holds only what differs for that package.

## Assumptions

- The shared config stays on ESLint 9 flat config, which is what the Choreo
  packages use. `eslint-plugin-boxel` runs on ESLint 8 with legacy configs, so
  the shared config gets its own workspace package rather than living there.
- The resolved config for every file should stay the same. The one exception
  is the test app's `.template-lintrc.js`, which joins the other
  `require`-loaded config files in getting eslint-plugin-n's rules and Node
  globals.

## Steps

1. Add `packages/choreo-eslint-config` (`@cardstack/choreo-eslint-config`,
   private), exporting:
   - the base config array as the default export;
   - `erasableSyntax`, the `no-restricted-syntax` selectors a block spreads when
     it sets that rule;
   - `commonjs(files)`, which lints `.js` files loaded through `require` as
     CommonJS Node scripts.
2. The shared package owns the ESLint plugin dependencies. Each Choreo package
   drops them and depends on the shared package instead (the gallery keeps
   `globals` for its own override).
3. Keep one `ember.configs.gts`, the one in the `**/*.{ts,gts}` block's
   `extends`, after typescript-eslint's configs.
4. Rewrite each package's `eslint.config.mjs` as
   `defineConfig([globalIgnores([...]), base, ...overrides])`.
5. Lint the shared package in CI Lint.

## Target files

- `packages/choreo-eslint-config/*` (new)
- `packages/{glimmer-motion,choreo-player,choreo-gallery,choreo-test-app}/eslint.config.mjs`
- the same packages' `package.json`, and `pnpm-lock.yaml`
- `.github/workflows/ci-lint.yaml`

## Testing

- Dump `ESLint#calculateConfigForFile` for every lintable file in each package,
  before and after, and diff them.
- Run `pnpm lint` in all four packages and in the shared package, in CI's
  order (glimmer-motion and choreo-player are built before the test app and
  the gallery lint).
- Lint probe files to confirm the erasable-syntax and public-asset selectors
  still fire.

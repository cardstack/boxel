# Rename the boxel-ui docs app's ambient types directory

## Goal

`packages/boxel-ui/docs-app/types/boxel-ui-test-app/index.d.ts` holds the docs app's ambient `import 'ember-source/types'`. The directory name points at a `test-app` package that the docs app is not; `test-app` names the Choreo test app. Rename the directory to `types/boxel-ui-docs-app/`, which matches the docs app's package name, `boxel-ui-docs-app`.

## Assumptions

- Nothing refers to the directory by name. The docs app's `tsconfig.json` picks the file up through `include: ["types/**/*"]` and resolves bare specifiers through `paths: { "*": ["types/*"] }`, and neither depends on the directory name.

## Steps

1. `git mv packages/boxel-ui/docs-app/types/boxel-ui-test-app packages/boxel-ui/docs-app/types/boxel-ui-docs-app`.
2. Run `pnpm lint` in `packages/boxel-ui/docs-app`. Its `lint:types` step (`ember-tsc --noEmit`) confirms the ember-source types still load.

## Testing

Type declarations only, with no runtime change. The docs app's `pnpm lint` (eslint, template-lint, `ember-tsc`) is the check.

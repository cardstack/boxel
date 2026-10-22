# CS-13388: Remove boxel-ui's stale `test-app/templates` module declaration

Linear: [CS-13388](https://linear.app/cardstack/issue/CS-13388) · Project: Choreo Productionization

## Goal

Delete `packages/boxel-ui/src/types/global.d.ts`. Its only content is an ambient `declare module 'test-app/templates/*'`, which types compiled classic templates under a package named `test-app`. The boxel-ui docs app's package is `boxel-ui-docs-app`, and `test-app` names the Choreo test app (`packages/choreo-test-app`), so the declaration points at the wrong package.

## Assumptions

- Nothing imports `test-app/templates/*` from boxel-ui or its docs app (confirmed by grep).
- No tsconfig, rollup config or package `files` entry names `global.d.ts` explicitly; it is picked up only through `src/**/*`. The publish build emits declarations from `.ts`/`.gts` sources, so a hand-written `.d.ts` in `src/types` never reaches `declarations/`.

## Steps

1. `git rm packages/boxel-ui/src/types/global.d.ts`.
2. Run `pnpm lint` in `packages/boxel-ui` and `packages/boxel-ui/docs-app`.

## Target files

- `packages/boxel-ui/src/types/global.d.ts` (deleted)

## Testing notes

No behavior changes, so no new tests. `lint:types` (`ember-tsc --noEmit`) in both packages is the check that would catch a lost declaration.

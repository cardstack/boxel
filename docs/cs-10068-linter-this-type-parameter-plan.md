# CS-10068 Plan: Allow `function (this: Type)` in correctness linter

## Goals
- Stop the correctness check from flagging explicit `this` parameters.
- Preserve unused-parameter reporting for other parameters.

## Assumptions
- The warning comes from the custom correctness linter, not TypeScript.
- We can special-case the `this` parameter or tune the ignore pattern.

## Steps
1. Locate the rule emitting the correctness warning for this case.
2. Update the rule to treat `this` parameters as allowed.
3. Add a regression test that uses `function (this: SomeType)`.
4. Run lint/tests for the affected package.

## Target files
- Linter rule implementation (to be identified).
- Linter rule tests/fixtures (to be identified).
- Config for unused parameter checks, if applicable.

## Testing notes
- Run targeted linter tests if available.
- Run `pnpm lint` in the affected package per workspace rules.

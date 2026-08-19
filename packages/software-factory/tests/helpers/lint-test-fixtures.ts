/**
 * Shared lint test fixtures used by `lint-validation.spec.ts` (which tests
 * the full `LintValidationStep` including `LintResult` artifact creation)
 * and `run-lint-in-memory.spec.ts` (which tests the in-memory agent tool).
 *
 * The same dirty source is used by both specs so any future tweak to the
 * canonical "intentionally broken" sample stays in one place.
 */

/**
 * A `.gts` file with a lint violation that the realm's `_lint` endpoint
 * (ESLint + Prettier + `@cardstack/boxel` rules) reports as an error. The
 * `no-unused-vars` rule flags `unusedVar` and auto-fix cannot remove it.
 */
export const BAD_LINT_GTS = `import {
  CardDef,
} from '@cardstack/base/card-api';

let unusedVar = 42;

export class BadCard extends CardDef {}
`;

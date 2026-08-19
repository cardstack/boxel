# Scripts

| Script                             | Purpose                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `run-tests.mjs`                    | Runs every suite under `tests/unit`, `tests/smoke`, and `tests/boxel`; backs `pnpm test`.                              |
| `verify-authorization-fixtures.ts` | Checks the pinned OpenFGA fixture hashes and the assertion inventory; backs `pnpm fixtures:authorization:verify`.      |
| `run-authorization-conformance.ts` | Executes the OpenFGA conformance corpus and reports pass/fail accounting; backs `pnpm test:authorization:conformance`. |
| `bench-authorization.ts`           | Times authorization prepare/check/batch paths; backs `pnpm bench:authorization`.                                       |

Each `.ts` script runs directly under Node — there is no build step.

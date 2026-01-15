# CS-10018: User signup credits missing

## Goals
- Ensure new user signup grants the default 2000 credits.
- Keep existing credit balance behaviors unchanged for existing users.

## Assumptions
- The credit balance is persisted server-side and surfaced on the workspace/home UI.
- A "signup" flow exists in the realm/host server that can be updated to seed credits.
- The intended default credit value is 2000 (per issue description).

## Steps
- Locate the signup flow and current credit initialization logic.
- Identify where the credit balance is computed and surfaced in the UI/API.
- Add/adjust server logic to set default credits on first signup.
- Add a focused test that covers new user credit balance.
- Run targeted lint/tests for the touched package.

## Target files
- Likely in `packages/realm-server` or `packages/host` auth/session logic.
- Possibly in shared credit/billing modules under `packages/billing` or `packages/runtime-common`.

## Testing notes
- Add a narrow test in the existing auth/session test suite that asserts 2000 credits on signup.
- Run `pnpm lint` in modified packages and targeted tests if available.

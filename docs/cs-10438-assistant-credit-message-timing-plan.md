## Goal
- Prevent the AI assistant from showing “Credits added!” unless we have
  evidence the balance increased after an out-of-credits error.

## Assumptions
- The out-of-credits error text can appear even when the cached balance
  is already above the minimum, so we should avoid claiming credits were
  added in that case.
- It is still desirable to show “Credits added!” after the balance
  transitions from below-minimum to above-minimum while the error is
  displayed.

## Plan
1. Update `AiAssistantMessage` to track whether the balance was below the
   minimum the first time an out-of-credits error is shown.
2. Only render the “Credits added!” label when the error was first shown
   while below the minimum and the balance is now above it.
3. Add an integration test that simulates an out-of-credits error while
   the billing service already reports sufficient credits, asserting that
   “Credits added!” does not render (but Retry does).

## Target Files
- `packages/host/app/components/ai-assistant/message/index.gts`
- `packages/host/tests/integration/components/ai-assistant-panel/general-test.gts`

## Testing Notes
- Run `pnpm lint` in `packages/host`.
- If feasible, run a focused Ember test for the new scenario.

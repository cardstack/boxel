// A ceiling on one teardown step.
//
// Lives apart from `integration.ts` for the same reason `fixture-budgets` does:
// importing the harness pulls in the realm-server test helpers, which resolve a
// Synapse registration secret at module scope and throw without one, so
// anything the unit suite needs to reach has to sit outside it.

// Three outcomes, because two of them are not the same thing and the caller
// says so in its logs:
//
//   finished  the step completed
//   expired   the budget ran out with the step still going — deliberate
//             abandonment, the case the budgets exist for
//   failed    the step rejected: nothing is still running, something is broken
//
// Collapsing the last two into one boolean makes teardown report a timeout that
// did not happen, which is a costly thing to read in CI: it sends whoever is
// looking at a red build hunting for a slow queue drain when what actually
// happened was an immediate rejection.
export type BudgetOutcome = 'finished' | 'expired' | 'failed';

// Never rejects, whatever the step does. A teardown failure must not replace
// whatever the suite was reporting — the suite has already made its findings,
// and the resources this releases are process-wide, so the file that gets hurt
// by a half-finished teardown is the next one, not this one. The caller's job
// is to keep going and say what happened; see `stopTestRealmServer`.
//
// The timer is unref'd so a step still running cannot be the reason the process
// stays up.
export async function withBudget(
  label: string,
  step: Promise<unknown>,
  budgetMs: number,
): Promise<BudgetOutcome> {
  let timer: NodeJS.Timeout | undefined;
  let outcome = await Promise.race([
    step.then(
      (): BudgetOutcome => 'finished',
      (e: unknown): BudgetOutcome => {
        console.warn(`[teardown] ${label} failed: ${String(e)}`);
        return 'failed';
      },
    ),
    new Promise<BudgetOutcome>((resolve) => {
      timer = setTimeout(() => resolve('expired'), budgetMs);
      timer.unref();
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  return outcome;
}

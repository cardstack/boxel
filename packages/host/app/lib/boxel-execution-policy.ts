import {
  executionDecisionForFormat,
  type BoxelSourceClassification,
} from './boxel-source-classifier';

import type { BoxelExecutionMode } from './boxel-runtime';

export interface BoxelExecutionPolicyInput {
  trusted: boolean;
  format?: string;
  source: BoxelSourceClassification;
  prefersFullSandbox: boolean;
  /**
   * Volatile promotion (docs/boxel-volatile-execution-plan.md): the module
   * is under active source editing for this tab's session. Strengthens
   * isolation the same way `prefersFullSandbox` does — routes to Sandbox
   * even when classification alone would pick Capsule, since Sandbox is
   * where the HMR machinery lives in v1 — but never overrides `trusted`:
   * volatile promotion is for user cards under active edit, never the
   * platform's own trusted graph (guarded primarily at
   * `BoxelExecutionService.promoteToVolatile()`, which is inert for a
   * trusted module identifier; this ordering is a second, structural
   * guarantee of the same rule).
   */
  volatile: boolean;
}

export interface BoxelExecutionDecision {
  mode: BoxelExecutionMode;
  reason: string;
}

/**
 * Select execution from trust and analyzed source. URL state is deliberately
 * absent: authored code cannot weaken its boundary by changing navigation.
 */
export function decideBoxelExecution(
  input: BoxelExecutionPolicyInput,
): BoxelExecutionDecision {
  if (input.prefersFullSandbox) {
    return { mode: 'sandbox', reason: 'prefers-full-sandbox' };
  }
  if (input.trusted) {
    return { mode: 'direct', reason: 'trusted-boxel-module' };
  }
  if (input.volatile) {
    return { mode: 'sandbox', reason: 'volatile-promotion' };
  }
  let decision = executionDecisionForFormat(input.source, input.format);
  return {
    mode: decision.tier,
    reason: decision.reason,
  };
}

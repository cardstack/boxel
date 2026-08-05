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
  let decision = executionDecisionForFormat(input.source, input.format);
  return {
    mode: decision.tier,
    reason: decision.reason,
  };
}

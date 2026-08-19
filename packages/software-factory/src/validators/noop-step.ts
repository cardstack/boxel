import type {
  ValidationStep,
  ValidationStepResult,
} from '../factory-agent/index.ts';

import type { ValidationStepRunner } from './validation-pipeline.ts';

/**
 * No-op validation step that always passes.
 * Used as a placeholder for unimplemented steps (parse, lint, evaluate, instantiate).
 * Each placeholder will be replaced by a real implementation via child issues.
 */
export class NoOpStepRunner implements ValidationStepRunner {
  readonly step: ValidationStep;

  constructor(step: ValidationStep) {
    this.step = step;
  }

  async run(_targetRealm: string): Promise<ValidationStepResult> {
    return { step: this.step, passed: true, errors: [] };
  }

  formatForContext(_result: ValidationStepResult): string {
    return '';
  }
}

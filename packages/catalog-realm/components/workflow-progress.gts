import GlimmerComponent from '@glimmer/component';
import type { WorkflowStepInterface } from '../card-generation/workflow-step';

interface WorkflowProgressSignature {
  Args: {
    steps?: WorkflowStepInterface<any>[];
  };
  Element: HTMLElement;
}

export default class WorkflowProgress extends GlimmerComponent<WorkflowProgressSignature> {
  get steps(): WorkflowStepInterface<any>[] {
    return this.args.steps ?? [];
  }

  isLastStep = (index: number): boolean => {
    return index === this.steps.length - 1;
  };

  getStepClass = (step: WorkflowStepInterface<any>): string => {
    let state = step?.state ?? 'idle';
    return `workflow-progress__step workflow-progress__step--${state}`;
  };

  getLineClass = (index: number): string => {
    let steps = this.steps;
    if (!steps || index >= steps.length - 1) {
      return 'workflow-progress__line';
    }

    let currentStep = steps[index];
    let nextStep = steps[index + 1];

    if (!currentStep || !nextStep) {
      return 'workflow-progress__line';
    }

    let currentState = currentStep.state ?? 'idle';
    let nextState = nextStep.state ?? 'idle';

    // Both steps successful = green line
    if (currentState === 'success' && nextState === 'success') {
      return 'workflow-progress__line workflow-progress__line--complete';
    }

    // Current success, next pending = gradient line
    if (currentState === 'success' && nextState === 'pending') {
      return 'workflow-progress__line workflow-progress__line--pending';
    }

    // Current success, next error = red line (workflow stopped at error)
    if (currentState === 'success' && nextState === 'error') {
      return 'workflow-progress__line workflow-progress__line--error';
    }

    // Current error = red line (workflow failed here)
    if (currentState === 'error') {
      return 'workflow-progress__line workflow-progress__line--error';
    }

    // Current pending = show as in progress
    if (currentState === 'pending') {
      return 'workflow-progress__line workflow-progress__line--pending';
    }

    // Default: grey line (idle state)
    return 'workflow-progress__line';
  };

  <template>
    <div class='workflow-progress' ...attributes>
      {{#each this.steps as |step index|}}
        <div class='workflow-progress__item'>
          <div class={{this.getStepClass step}}></div>
          {{#unless (this.isLastStep index)}}
            <div class={{this.getLineClass index}}></div>
          {{/unless}}
        </div>
      {{/each}}
    </div>

    <style scoped>
      .workflow-progress {
        display: flex;
        align-items: center;
        gap: 0;
      }

      .workflow-progress__item {
        display: flex;
        align-items: center;
        flex: 1;
      }

      .workflow-progress__item:last-child {
        flex: 0;
      }

      .workflow-progress__step {
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        flex-shrink: 0;
        border: 2px solid;
        transition: all var(--boxel-transition);
      }

      .workflow-progress__step--idle {
        background: var(--boxel-100);
        border-color: var(--boxel-300);
        color: var(--boxel-500);
      }

      .workflow-progress__step--pending {
        background: var(--boxel-purple-100);
        border-color: var(--boxel-purple-400);
        color: var(--boxel-purple-700);
        animation: pulse 2s ease-in-out infinite;
      }

      .workflow-progress__step--success {
        background: var(--boxel-success-100);
        border-color: var(--boxel-success-200);
        color: var(--boxel-success-300);
      }

      .workflow-progress__step--error {
        background: var(--boxel-danger-100, #ffeaea);
        border-color: var(--boxel-danger);
        color: var(--boxel-danger);
      }

      .workflow-progress__step-number {
        display: none;
      }

      .workflow-progress__line {
        height: 2px;
        flex: 1;
        background: var(--boxel-300);
        margin: 0 var(--boxel-sp-xs);
        transition: background var(--boxel-transition);
      }

      .workflow-progress__line--complete {
        background: var(--boxel-success-200);
      }

      .workflow-progress__line--pending {
        background: linear-gradient(
          90deg,
          var(--boxel-success-200) 0%,
          var(--boxel-purple-400) 100%
        );
      }

      .workflow-progress__line--error {
        background: var(--boxel-danger);
      }

      @keyframes pulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(1.1);
          opacity: 0.8;
        }
      }
    </style>
  </template>
}

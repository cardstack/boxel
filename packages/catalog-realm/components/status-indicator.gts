import Component from '@glimmer/component';
import { CircleSpinner } from '@cardstack/boxel-ui/components';

export type StatusIndicatorState =
  | 'idle'
  | 'pending'
  | 'success'
  | 'error';

interface Signature {
  Args: {
    state?: StatusIndicatorState;
  };
}

export default class StatusIndicator extends Component<Signature> {
  get state(): StatusIndicatorState {
    return this.args.state ?? 'idle';
  }

  get classNames(): string {
    return [
      'workflow-step-indicator',
      `workflow-step-indicator--${this.state}`,
    ].join(' ');
  }

  get symbol(): string | null {
    switch (this.state) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      default:
        return null;
    }
  }

  get showSpinner(): boolean {
    return this.state === 'pending';
  }

  <template>
    <span class={{this.classNames}}>
      {{#if this.showSpinner}}
        <CircleSpinner
          width='16'
          height='16'
          class='workflow-step-indicator__spinner'
        />
      {{else if this.symbol}}
        {{this.symbol}}
      {{/if}}
    </span>

    <style scoped>
      .workflow-step-indicator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 999px;
        border: 1px solid var(--boxel-300);
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--boxel-700);
        background: var(--boxel-0);
        flex-shrink: 0;
        position: relative;
      }

      .workflow-step-indicator--idle {
        border-color: var(--boxel-200);
        color: var(--boxel-400);
      }

      .workflow-step-indicator--pending {
        border-color: var(--boxel-purple-400);
        color: var(--boxel-purple-400);
      }

      .workflow-step-indicator--success {
        border-color: var(--boxel-success-300, var(--boxel-success));
        color: var(--boxel-success-700);
      }

      .workflow-step-indicator--error {
        border-color: var(--boxel-danger);
        color: var(--boxel-danger);
      }

      .workflow-step-indicator__spinner {
        --icon-color: var(--boxel-purple-400);
        width: 1rem;
        height: 1rem;
      }
    </style>
  </template>
}

import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { cn, eq } from '../../helpers.ts';
import { FailureBordered, Warning } from '../../icons.gts';
import Button from '../button/index.gts';

interface Signature {
  Args: {
    messages: string[];
    retryAction?: () => void;
    type: 'error' | 'warning';
  };
  Element: HTMLDivElement;
}

export default class Alert extends Component<Signature> {
  private get showRetryButton() {
    return this.args.retryAction != null && this.args.type === 'error';
  }

  private get retryAction() {
    return this.args.retryAction ?? (() => {});
  }

  <template>
    <div
      class={{cn
        'alert-container'
        error=(eq @type 'error')
        warning=(eq @type 'warning')
      }}
      data-test-boxel-alert={{@type}}
      ...attributes
    >

      <div class='alert-headers'>
        {{#each @messages as |message|}}
          <div class='alert-header'>
            {{#if (eq @type 'error')}}
              <FailureBordered class='alert-icon' />
            {{else}}
              <Warning class='alert-icon' />
            {{/if}}
            <p class='error-message' data-test-card-error>
              {{message}}
            </p>
          </div>
        {{/each}}
      </div>

      {{#if this.showRetryButton}}
        <Button
          {{on 'click' this.retryAction}}
          class='retry-button'
          @size='small'
          @kind='primary'
          data-test-ai-bot-retry-button
        >
          Retry
        </Button>
      {{/if}}
    </div>

    <style scoped>
      .alert-container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        padding-bottom: var(--boxel-sp);
        color: var(--boxel-light);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
        border-radius: var(--boxel-border-radius-lg);
      }

      .alert-container.error {
        background-color: #3b394b;
      }

      .alert-container.warning {
        background-color: var(--boxel-warning-200);
      }

      .alert-header {
        display: flex;
        gap: var(--boxel-sp-xs);
      }

      .alert-headers {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      .error .alert-icon {
        --icon-background-color: var(--boxel-error-400);
        --icon-color: var(--boxel-light);
        min-width: 20px;
        height: 20px;
      }

      .warning .alert-icon {
        --icon-color: var(--boxel-dark);
        min-width: 20px;
        height: 20px;
      }

      .error-message {
        align-self: center;
        overflow: hidden;
        word-wrap: break-word;
        overflow-wrap: break-word;
        margin: 0;
      }

      .retry-button {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: max-content;
        --boxel-button-min-width: max-content;
        border-color: transparent;
        width: fit-content;
        margin-left: auto;
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
    </style>
  </template>
}

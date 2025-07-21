import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { cn, eq } from '../../helpers.ts';
import { FailureBordered, Warning } from '../../icons.gts';
import Button from '../button/index.gts';

interface Signature {
  Args: {
    messages: string[];
    retryAction?: () => void;
    type?: 'error' | 'warning';
  };
  Blocks: {
    actions: [];
  };
  Element: HTMLDivElement;
}

const Alert: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn
      'alert-container'
      error-container=(eq @type 'error')
      warning-container=(eq @type 'warning')
    }}
    data-test-boxel-alert={{@type}}
    ...attributes
  >
    {{#each @messages as |message i|}}
      <div class='alert'>
        {{#if (eq @type 'error')}}
          <FailureBordered class='alert-icon' />
        {{else if (eq @type 'warning')}}
          <Warning class='alert-icon' />
        {{/if}}
        <p
          class='message'
          data-test-alert-message='{{i}}'
          data-test-card-error={{eq @type 'error'}}
        >
          {{message}}
        </p>
      </div>
    {{/each}}

    {{#if (has-block 'actions')}}
      {{yield to='actions'}}
    {{else if @retryAction}}
      <Button
        {{on 'click' @retryAction}}
        class='retry-button'
        @size='small'
        @kind='primary'
        data-test-alert-retry-button
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
      padding: var(--boxel-sp-sm);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-sm);
      border-radius: var(--boxel-border-radius-xxl);
    }
    .error-container {
      background-color: var(--boxel-650);
      color: var(--boxel-light);
    }
    .warning-container {
      background-color: var(--boxel-warning-200);
      color: var(--boxel-dark);
    }
    .alert {
      display: flex;
      gap: var(--boxel-sp-xs);
    }
    .alert + .alert {
      margin-top: var(--boxel-sp-lg);
    }
    .alert-icon {
      min-width: 20px;
      height: 20px;
    }
    .error-container .alert-icon {
      --icon-background-color: var(--boxel-error-400);
    }
    .message {
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
    .alert + .retry-button {
      margin-top: var(--boxel-sp-sm);
    }
  </style>
</template>;

export default Alert;

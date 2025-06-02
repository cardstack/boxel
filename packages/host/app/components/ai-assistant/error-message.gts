import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { FailureBordered } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    errorMessage: string;
    retryAction?: () => void;
  };
}

const ErrorMessage: TemplateOnlyComponent<Signature> = <template>
  <div class='error-container' data-test-ai-assistant-error ...attributes>
    <div class='error-header'>
      <FailureBordered class='error-icon' />
      <p class='error-message' data-test-card-error>
        {{@errorMessage}}
      </p>
    </div>

    {{#if @retryAction}}
      <Button
        {{on 'click' @retryAction}}
        class='retry-button'
        @size='small'
        @kind='secondary-dark'
        data-test-ai-bot-retry-button
      >
        Retry
      </Button>
    {{/if}}
  </div>

  <style scoped>
    .error-container {
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp-sm);
      padding-bottom: var(--boxel-sp);
      background-color: #ff5050;
      color: var(--boxel-light);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp);
      border-radius: var(--boxel-border-radius-lg);
    }

    .error-header {
      display: flex;
      gap: var(--boxel-sp-xs);
    }

    .error-icon {
      --icon-background-color: var(--boxel-light);
      --icon-color: #ff5050;
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
      border-color: var(--boxel-light);
      width: fit-content;
      margin-left: auto;
      font-size: var(--boxel-font-size-xs);
      font-weight: 500;
    }
  </style>
</template>;

export default ErrorMessage;

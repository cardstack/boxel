import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { Button } from '@cardstack/boxel-ui/components';

import assistantIcon from './ai-assist-icon@2x.webp';

interface Signature {
  Args: {
    sendPrompt?: (message: string) => void;
    errorAction?: () => void;
  };
}

const NewSession: TemplateOnlyComponent<Signature> = <template>
  <div class='intro' data-test-new-session>
    <div class='title-group'>
      <img alt='AI Assistant' src={{assistantIcon}} width='40' height='40' />
      <h2 class='title-text'>Assistant</h2>
    </div>
    {{#if @errorAction}}
      <div class='error-section' data-test-room-error>
        <p class='message'>
          We've encountered an error, please try again later.
        </p>
        <Button @size='small' @kind='primary' {{on 'click' @errorAction}}>
          Try Again
        </Button>
      </div>
    {{else}}
      <p class='message'>
        Boxel Assistant is an AI that helps you edit content, design interfaces,
        write code, and plan workflows using simple text prompts. Just ask the
        assistant to get started.
      </p>
      <p class='disclaimer'>
        Assistant may display inaccurate info, please double check its
        responses.
      </p>
    {{/if}}
  </div>

  <style scoped>
    .intro {
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-xl);
      height: 100%;
      padding: var(--boxel-sp-xl) var(--boxel-sp-xxxs) 0;
      color: var(--boxel-light);
      letter-spacing: var(--boxel-lsp);
      overflow: auto;
    }
    .title-group {
      display: flex;
      gap: var(--boxel-sp-xs);
      align-items: center;
    }
    .title-text {
      margin: 0;
      font-weight: 600;
      font-size: 1.625rem;
      line-height: 1.25;
    }
    .message {
      margin: 0;
      padding: var(--boxel-sp-4xs);
      font: 600 var(--boxel-font);
      line-height: 1.5;
    }
    .error-section > * + * {
      margin-top: var(--boxel-sp-sm);
    }
    .disclaimer {
      margin: 0;
      color: var(--boxel-450);
      font: var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xs);
    }
  </style>
</template>;

export default NewSession;

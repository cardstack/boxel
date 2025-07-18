import { TemplateOnlyComponent } from '@ember/component/template-only';
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
    .prompts {
      list-style-type: none;
      margin: 0;
      padding-left: 0;
    }
    .prompts > li + li {
      margin-top: var(--boxel-sp-xxs);
    }
    .prompt::before {
      display: inline-block;
      margin-right: var(--boxel-sp-sm);
      /* 1.5px for both values causes a build failure TODO fix in CS-8981 */
      padding: 0 0 1.49px 1.5px;
      content: '?';
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 50%;
      background-color: var(--boxel-highlight);
      color: var(--boxel-dark);
      font: 500 var(--boxel-font);
    }
    .prompt {
      color: var(--boxel-light);
      font: 500 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp);
      padding-left: var(--boxel-sp-xxs);
    }
    .prompt:hover:not(:disabled) {
      color: var(--boxel-highlight);
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

import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { Button } from '@cardstack/boxel-ui/components';

import assistantIcon from './ai-assist-icon@2x.webp';

interface Signature {
  Element: HTMLElement;
  Args: {
    errorAction?: () => void;
  };
}

export default class NewSession extends Component<Signature> {
  <template>
    <div class='intro' data-test-new-session ...attributes>
      <div class='title-group'>
        <img alt='AI Assistant' src={{assistantIcon}} width='40' height='40' />
        <h2 class='title-text'>Assistant</h2>
      </div>
      {{#if @errorAction}}
        <div>
          <p class='message error'>
            We've encountered an error, please try again later.
          </p>
          <Button @size='small' @kind='primary' {{on 'click' @errorAction}}>
            Try Again
          </Button>
        </div>
      {{else}}
        <p class='message'>Boxel Assistant is an AI that produces tailored
          responses by merging analytics and cognitive computing. Build a
          website, batch edit photos or streamline your workflows - all with
          just a few simple text prompts.</p>
      {{/if}}
    </div>

    <style>
      .intro {
        display: flex;
        flex-direction: column;
        justify-content: center;
        height: 100%;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
      }
      .intro > * + * {
        margin-top: var(--boxel-sp-xl);
      }
      .title-group {
        display: flex;
        gap: var(--boxel-sp-xs);
        align-items: center;
      }
      .title-text {
        margin: 0;
        font-weight: 700;
        font-size: 1.625rem;
        line-height: 1.25;
        letter-spacing: var(--boxel-lsp);
      }
      .message {
        padding: var(--boxel-sp-4xs);
        color: var(--boxel-light);
        font: 700 var(--boxel-font);
        line-height: 1.5;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .error {
        margin-top: 0;
      }
    </style>
  </template>
}

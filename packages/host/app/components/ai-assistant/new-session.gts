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
        <div data-test-room-error>
          <p class='message'>
            We've encountered an error, please try again later.
          </p>
          <Button @size='small' @kind='primary' {{on 'click' @errorAction}}>
            Try Again
          </Button>
        </div>
      {{else}}
        <p class='message'>
          Boxel Assistant is an AI that produces tailored responses by merging
          analytics and cognitive computing. Build a website, batch edit photos
          or streamline your workflows - all with just a few simple text
          prompts.
        </p>
        <ul class='prompts'>
          <li>What kind of things can AI do?</li>
          <li>Do I have to use AI with Boxel?</li>
          <li>Will my data be safe?</li>
        </ul>
      {{/if}}
    </div>

    <style>
      .intro {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--boxel-sp-xl);
        height: 100%;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        color: var(--boxel-light);
        letter-spacing: var(--boxel-lsp);
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
      }
      .message {
        margin: 0;
        padding: var(--boxel-sp-4xs);
        font: 700 var(--boxel-font);
        line-height: 1.5;
      }
      .prompts {
        margin: 0;
        padding-left: var(--boxel-sp);
        font: 500 var(--boxel-font-sm);
      }
      .prompts > li + li {
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>
}

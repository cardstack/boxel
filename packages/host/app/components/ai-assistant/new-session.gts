import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';

import assistantIcon from './ai-assist-icon@2x.webp';

interface Signature {
  Args: {
    sendPrompt?: (message: string) => void;
    errorAction?: () => void;
  };
}

export default class NewSession extends Component<Signature> {
  <template>
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
          Boxel Assistant is an AI that produces tailored responses by merging
          analytics and cognitive computing. Build a website, batch edit photos
          or streamline your workflows - all with just a few simple text
          prompts.
        </p>
        {{#if @sendPrompt}}
          <ul class='prompts'>
            {{#each this.prompts as |prompt i|}}
              <li>
                <Button
                  class='prompt'
                  @kind='text-only'
                  {{on 'click' (fn @sendPrompt prompt)}}
                  data-test-prompt={{i}}
                >
                  {{prompt}}
                </Button>
              </li>
            {{/each}}
          </ul>
        {{/if}}
        <small>
          Assistant may display inacurrate info, please double check its
          responses.
        </small>
      {{/if}}
    </div>

    <style>
      .intro {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        height: 100%;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
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
      small {
        display: block;
        color: var(--boxel-450);
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>

  private prompts = [
    'What kind of things can AI do?',
    'Do I have to use AI with Boxel?',
    'Will my data be safe?',
  ];
}

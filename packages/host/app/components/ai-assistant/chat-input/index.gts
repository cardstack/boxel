import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { BoxelInput, IconButton } from '@cardstack/boxel-ui/components';
import { Send } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    value: string;
    onInput: (val: string) => void;
    onSend: () => void;
  };
}

export default class AiAssistantChatInput extends Component<Signature> {
  <template>
    <div class='chat-input-container'>
      <label for='ai-chat-input' class='boxel-sr-only'>
        Enter text to chat with AI Assistant
      </label>
      <BoxelInput
        class='chat-input'
        @id='ai-chat-input'
        @type='textarea'
        @value={{@value}}
        @onInput={{@onInput}}
        @onKeyPress={{this.onKeyPress}}
        @placeholder='Enter text here'
        ...attributes
      />
      <IconButton
        {{on 'click' @onSend}}
        class='send-button'
        @icon={{Send}}
        @height='20'
        @width='20'
      >
        Send
      </IconButton>
    </div>
    <style>
      .chat-input-container {
        display: grid;
        grid-template-columns: 1fr auto;
        padding: var(--boxel-sp) var(--boxel-sp-xs) var(--boxel-sp)
          var(--boxel-sp);
        background-color: var(--boxel-light);
        border-radius: var(--boxel-radius-sm);
      }
      .chat-input {
        border-color: transparent;
        font-weight: 500;
        resize: none;
      }
      .chat-input::placeholder {
        color: var(--boxel-400);
      }
      .chat-input:hover:not(:disabled) {
        border-color: var(--boxel-border-color);
      }
      .send-button {
        --icon-color: var(--boxel-highlight);
        height: 30px;
        padding-bottom: var(--boxel-sp-xs);
      }
      .send-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight-hover);
      }
      .send-button > :deep(svg) {
        margin: 0;
      }
    </style>
  </template>

  @action onKeyPress(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.args.onSend();
    }
  }
}

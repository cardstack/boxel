import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import { BoxelInput, IconButton } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { Send } from '@cardstack/boxel-ui/icons';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    value: string;
    onInput: (val: string) => void;
    onSend: (val: string) => void;
    isSending: boolean;
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
        @placeholder='Enter text here'
        {{onKeyMod 'cmd+Enter' this.onSend}}
        {{onKeyMod 'ctrl+Enter' this.onSend}}
        {{setCssVar chat-input-height=this.height}}
        ...attributes
      />
      <IconButton
        {{on 'click' this.onSend}}
        {{! TODO we should visually surface this loading state }}
        @disabled={{@isSending}}
        data-test-can-send-msg={{not @isSending}}
        class='send-button'
        @icon={{Send}}
        @height='20'
        @width='20'
        data-test-send-message-btn
      >
        Send
      </IconButton>
    </div>
    <style>
      .chat-input-container {
        display: grid;
        grid-template-columns: 1fr auto;
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-xs);
        background-color: var(--boxel-light);
      }
      .chat-input {
        height: var(--chat-input-height);
        border-color: transparent;
        font-weight: 500;
        padding: var(--boxel-sp-xxs);
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
    </style>
  </template>

  @action onSend() {
    this.args.onSend(this.args.value);
  }

  get height() {
    const lineHeight = 20;
    const padding = 9;

    let lineCount = (this.args.value.match(/\n/g) ?? []).length + 1;
    let count = 2;

    if (lineCount > 5) {
      count = 5;
    } else if (lineCount > 2) {
      count = lineCount;
    }

    let height = count * lineHeight + 2 * padding;
    return `${height}px`;
  }
}

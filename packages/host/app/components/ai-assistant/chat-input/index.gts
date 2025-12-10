import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import { IconButton } from '@cardstack/boxel-ui/components';
import { not, pick } from '@cardstack/boxel-ui/helpers';
import { ArrowUp } from '@cardstack/boxel-ui/icons';

import type AttachButton from '../attachment-picker/attach-button';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLTextAreaElement;
  Args: {
    value: string;
    onInput: (val: string) => void;
    onSend: () => void;
    canSend: boolean;
    attachButton?: WithBoundArgs<
      typeof AttachButton,
      'chooseCard' | 'chooseFile'
    >;
  };
}

export default class AiAssistantChatInput extends Component<Signature> {
  <template>
    <div class='chat-input-container'>
      <label for='ai-chat-input' class='boxel-sr-only'>
        Enter text to chat with AI Assistant
      </label>
      {{#if @attachButton}}
        <@attachButton />
      {{/if}}
      <div class='input-and-clone'>
        <textarea
          class='chat-input'
          id='ai-chat-input'
          value={{@value}}
          placeholder='Enter a prompt'
          rows='1'
          {{on 'input' (pick 'target.value' @onInput)}}
          {{onKeyMod 'Shift+Enter' this.insertNewLine}}
          {{onKeyMod 'Enter' this.onSend}}
          data-test-boxel-input-id='ai-chat-input'
          ...attributes
        />
        <div class='clone'>{{@value}}</div>
      </div>
      <IconButton
        {{on 'click' this.onSend}}
        {{! TODO we should visually surface this loading state }}
        disabled={{not @canSend}}
        data-test-can-send-msg={{@canSend}}
        class='send-button'
        @variant='primary'
        @icon={{ArrowUp}}
        @height='20'
        @width='25'
        aria-label='Send'
        data-test-send-message-btn
      />
    </div>
    <style scoped>
      .chat-input-container {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        min-height: 54px;
        gap: var(--boxel-sp-xxs);
        padding: 0 var(--boxel-sp-sm);
        background-color: var(--boxel-light);
        border-top-left-radius: var(--chat-input-area-border-radius);
        border-top-right-radius: var(--chat-input-area-border-radius);

        /*
          Detecting overflow with CSS: https://csscade.com/can-you-detect-overflow-with-css/
          This adds a bottom border to this container when the input has overflowed.
        */

        animation: detect-input-overflow linear forwards;
        animation-timeline: --chat-input-scroll-timeline;

        --border-bottom-color-if-overflow: var(--has-overflow) var(--boxel-400);
        --border-bottom-color-no-overflow: transparent;

        border-bottom: 1px solid
          var(
            --border-bottom-color-if-overflow,
            var(--border-bottom-color-no-overflow)
          );
      }

      /* Adapted autoexpanding textarea: https://chriscoyier.net/2023/09/29/css-solves-auto-expanding-textareas-probably-eventually/ */
      .input-and-clone {
        display: grid;
      }

      .clone {
        white-space: pre-wrap;
        visibility: hidden;

        scroll-timeline: --chat-input-scroll-timeline block;
      }

      .chat-input,
      .clone {
        width: 100%;
        padding: var(--boxel-sp-4xs);

        max-height: 150px;
        overflow-y: auto;

        font: var(--boxel-font-sm);
        font-weight: 400;
        letter-spacing: var(--boxel-lsp-xs);

        grid-area: 1 / 1 / 2 / 2;
      }

      .chat-input {
        background: transparent;
        border: 0;
        border-radius: 0;
        resize: none;
        outline: 0;
      }

      @keyframes detect-input-overflow {
        from,
        to {
          --has-overflow: ;
        }
      }

      .chat-input::placeholder {
        color: var(--boxel-400);
      }
      .chat-input:hover:not(:disabled) {
        border-color: transparent;
      }
      .send-button {
        width: var(--boxel-icon-med);
        height: var(--boxel-icon-med);
        border-radius: var(--boxel-border-radius-sm);
        margin-top: 2px;
      }
      .send-button:disabled {
        color: var(--boxel-450);
        background-color: var(--boxel-300);
        pointer-events: none;
      }
      .send-button :deep(svg) {
        padding: var(--boxel-sp-5xs);
      }
    </style>
  </template>

  @action onSend(ev: Event) {
    ev.preventDefault();
    if ('shiftKey' in ev && ev.shiftKey) {
      return;
    }
    if (!this.args.canSend) {
      return;
    }
    this.args.onSend();
  }

  @action
  insertNewLine(event: KeyboardEvent) {
    const textarea = event.target as HTMLTextAreaElement;
    if (!textarea) {
      return;
    }

    const value = this.args.value;
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;

    const newValue = `${value.substring(0, startPos)}\n\n${value.substring(
      endPos,
    )}`;

    this.args.onInput(newValue);

    // Set the cursor position to be right after the inserted new line
    next(() => {
      textarea.selectionStart = textarea.selectionEnd = startPos + 2;
    });
  }
}

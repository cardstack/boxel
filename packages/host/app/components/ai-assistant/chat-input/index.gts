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
    onPaste?: (event: ClipboardEvent) => void | Promise<void>;
    canSend: boolean;
    isSending?: boolean;
    attachButton?: WithBoundArgs<
      typeof AttachButton,
      'chooseCard' | 'chooseFile' | 'chooseLocalFile'
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
          {{on 'paste' this.onPaste}}
          {{onKeyMod 'Shift+Enter' this.insertNewLine}}
          {{onKeyMod 'Enter' this.onSend}}
          data-test-boxel-input-id='ai-chat-input'
          ...attributes
        />
        <div class='clone'>{{@value}}</div>
      </div>
      <IconButton
        {{on 'click' this.onSend}}
        disabled={{not @canSend}}
        @loading={{@isSending}}
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
        gap: var(--step-4, 4px);
        padding: 0 var(--step-12, 12px);
        background-color: transparent;
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

        /* the entry reads at the reading size, 14 on 22 */
        font-family: var(--boxel-font-family);
        font-size: var(--type-read, 14px);
        line-height: var(--leading-read, 22px);
        font-weight: 400;
        letter-spacing: normal;

        grid-area: 1 / 1 / 2 / 2;
      }

      /* iOS zooms into inputs under 16px on focus */
      @media (pointer: coarse) {
        .chat-input,
        .clone {
          font-size: var(--boxel-font-size);
        }
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
        color: var(--boxel-500);
      }
      .chat-input:hover:not(:disabled) {
        border-color: transparent;
      }
      /* Send is the box's one primary: solid teal while there is something
         to send, a quiet grey well until then */
      .send-button {
        width: 2rem;
        height: 2rem;
        border-radius: var(--round-row, 8px);
        margin-top: 2px;
        background-color: var(--boxel-highlight);
        color: var(--boxel-dark);
      }
      .send-button:disabled {
        color: var(--boxel-450);
        background-color: var(--ai-composer-well, var(--boxel-200));
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
  onPaste(event: Event) {
    this.args.onPaste?.(event as ClipboardEvent);
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

import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import { BoxelInput, IconButton } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { ArrowUp } from '@cardstack/boxel-ui/icons';
import { setCssVar } from '@cardstack/boxel-ui/modifiers';

import AttachButton from '../attachment-picker/attach-button';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    value: string;
    onInput: (val: string) => void;
    onSend: () => void;
    canSend: boolean;
    attachButton?: WithBoundArgs<
      typeof AttachButton,
      'files' | 'cards' | 'chooseCard' | 'chooseFile'
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
      <BoxelInput
        class='chat-input'
        @id='ai-chat-input'
        @type='textarea'
        @value={{@value}}
        @onInput={{@onInput}}
        @placeholder='Enter a prompt'
        {{onKeyMod 'Shift+Enter' this.insertNewLine}}
        {{onKeyMod 'Enter' this.onSend}}
        {{setCssVar chat-input-height=this.height}}
        ...attributes
      />
      <IconButton
        {{on 'click' this.onSend}}
        {{! TODO we should visually surface this loading state }}
        disabled={{not @canSend}}
        data-test-can-send-msg={{@canSend}}
        class='send-button'
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
      }
      .chat-input {
        height: var(--chat-input-height);
        min-height: var(--chat-input-height);
        max-height: 300px;
        border: 0;
        border-radius: 0;
        font-weight: 400;
        padding: var(--boxel-sp-4xs);
        padding-top: 10px;
        resize: none;
        outline: 0;
        transition: height 0.2s ease-in-out;
        overflow-y: auto;
      }
      .chat-input::placeholder {
        color: var(--boxel-400);
      }
      .chat-input:hover:not(:disabled) {
        border-color: transparent;
      }
      .send-button {
        color: var(--boxel-dark);
        width: var(--boxel-icon-med);
        height: var(--boxel-icon-med);
        background-color: var(--boxel-highlight);
        border-radius: var(--boxel-border-radius-sm);
        margin-top: 2px;
      }
      .send-button:hover:not(:disabled),
      .send-button:focus:not(:disabled) {
        background-color: var(--boxel-highlight-hover);
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

  get height() {
    const lineHeight = 20;
    const padding = 8;
    const minLines = 1;
    const maxLines = 6;

    // Calculate actual line count from newlines in the content
    let newlineCount = (this.args.value.match(/\n/g) ?? []).length;

    // Also consider content length for lines that might wrap
    // This is a rough estimate that can be adjusted
    const charsPerLine = 60;
    let charLineCount = Math.ceil(this.args.value.length / charsPerLine);

    // Use whichever count is higher (newlines or character-based estimate)
    let estimatedLineCount = Math.max(newlineCount + 1, charLineCount);
    let lineCount = Math.min(Math.max(estimatedLineCount, minLines), maxLines);

    let height = lineCount * lineHeight + 2 * padding;
    return `${height}px`;
  }
}

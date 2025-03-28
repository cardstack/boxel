import Component from '@glimmer/component';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import { BoxelInput } from '@cardstack/boxel-ui/components';
import { ChevronRight } from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {
    value: string;
    onInput: (val: string) => void;
    onSend: () => void;
  };
}

export default class AskAiBox extends Component<Signature> {
  <template>
    <label for='ask-ai-box' class='boxel-sr-only'>
      Enter text to chat with AI Assistant
    </label>
    <div class='input-group'>
      <ChevronRight class='caret' width='40' height='40' role='presentation' />
      <BoxelInput
        class='ask-ai-input'
        @id='ask-ai-box'
        @value={{@value}}
        @onInput={{@onInput}}
        @placeholder='Ask AI'
        {{onKeyMod 'Enter' @onSend}}
      />
    </div>

    <style scoped>
      .input-group {
        position: relative;
      }
      .caret {
        position: absolute;
        left: 0;
        padding: 8px;
        color: var(--boxel-highlight);
      }
      .ask-ai-input {
        padding-left: var(--boxel-sp-xxl);
        background-color: var(--boxel-ai-purple);
        color: var(--boxel-light);
        border: var(--boxel-form-control-dark-mode-border);
        border-radius: var(--boxel-border-radius-xxl);
      }
      .ask-ai-input:hover:not(:disabled) {
        border-color: var(--boxel-light);
      }
      .ask-ai-input:focus:focus-visible {
        outline: 1px solid var(--boxel-highlight);
        outline-offset: -1px;
        border-color: transparent;
      }
      .ask-ai-input::placeholder {
        color: var(--boxel-form-control-dark-mode-placeholder-color);
      }
    </style>
  </template>
}

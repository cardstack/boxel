import type { TemplateOnlyComponent } from '@ember/component/template-only';

import onKeyMod from 'ember-keyboard/modifiers/on-key';

import { BoxelInput, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { ChevronRight } from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {
    value: string;
    onInput: (val: string) => void;
    onSend: () => void;
    isLoading?: boolean;
  };
}

const AskAiTextBox: TemplateOnlyComponent<Signature> = <template>
  <label for='ask-ai-box' class='boxel-sr-only' data-test-ask-ai-label>
    Message for new AI Assistant room
  </label>
  <div class='input-group'>
    <span class='icon-container'>
      {{#if @isLoading}}
        <LoadingIndicator />
      {{else}}
        <ChevronRight width='22' height='22' role='presentation' />
      {{/if}}
    </span>
    <BoxelInput
      class='ask-ai-input'
      @id='ask-ai-box'
      @value={{@value}}
      @onInput={{@onInput}}
      @placeholder='Ask AI'
      @disabled={{@isLoading}}
      @autocomplete='off'
      {{onKeyMod 'Enter' @onSend}}
      data-test-ask-ai-input
    />
  </div>
  <style scoped>
    .input-group {
      position: relative;
    }
    .icon-container {
      position: absolute;
      color: var(--boxel-highlight);
      top: 0;
      left: 0;
      margin-left: var(--boxel-sp-xs);
      height: var(--boxel-form-control-height);
      display: inline-flex;
      align-items: center;
    }
    .ask-ai-input {
      padding-left: var(--boxel-sp-xxl);
      background-color: var(--boxel-ai-purple);
      color: var(--boxel-light);
      border: var(--boxel-form-control-dark-mode-border);
      border-radius: var(--boxel-border-radius-2xl);
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
    .ask-ai-input:disabled {
      background-color: var(--boxel-ai-purple);
      color: var(--boxel-light);
      border: var(--boxel-form-control-dark-mode-border);
      opacity: 0.5;
    }
  </style>
</template>;

export default AskAiTextBox;

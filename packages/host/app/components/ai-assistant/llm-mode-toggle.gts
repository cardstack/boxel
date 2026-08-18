import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { Tooltip } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import type { LLMMode } from '@cardstack/runtime-common/matrix-constants';

interface Signature {
  Args: {
    selected: LLMMode;
    onChange: (mode: LLMMode) => void;
    disabled?: boolean;
    onExpand?: () => void;
    onCollapse?: () => void;
  };
  Element: HTMLElement;
}

export default class LLMModeToggle extends Component<Signature> {
  private get selected(): LLMMode {
    return this.args.selected === 'act' ? 'act' : 'ask';
  }

  <template>
    <div class='llm-mode-toggle' ...attributes>
      <Tooltip @placement='top'>
        <:trigger>
          <button
            type='button'
            class='llm-mode-option {{if (eq this.selected "ask") "selected"}}'
            disabled={{@disabled}}
            {{on 'click' (fn this.handleOptionClick 'ask')}}
            data-test-llm-mode-option='ask'
          >
            Ask
          </button>
        </:trigger>
        <:content>
          <div class='llm-mode-option-tooltip'>
            Ask mode: Get answers and explanations without making changes
          </div>
        </:content>
      </Tooltip>

      <Tooltip @placement='top'>
        <:trigger>
          <button
            type='button'
            class='llm-mode-option {{if (eq this.selected "act") "selected"}}'
            disabled={{@disabled}}
            {{on 'click' (fn this.handleOptionClick 'act')}}
            data-test-llm-mode-option='act'
          >
            Act
          </button>
        </:trigger>
        <:content>
          <div class='llm-mode-option-tooltip'>
            Act mode: Automatically apply code changes and execute commands
          </div>
        </:content>
      </Tooltip>
    </div>
    <style scoped>
      .llm-mode-toggle {
        --llm-mode-toggle-height: 1.875rem;
        --llm-mode-toggle-inset: 0.125rem;
        --llm-mode-option-width: 2.5rem;
        --llm-mode-option-height: calc(
          var(--llm-mode-toggle-height) - (2 * var(--llm-mode-toggle-inset))
        );

        display: flex;
        align-items: center;
        width: fit-content;
        height: var(--llm-mode-toggle-height);
        padding: var(--llm-mode-toggle-inset);
        background: var(--boxel-650);
        border-radius: calc(var(--llm-mode-toggle-height) / 2);
      }
      .llm-mode-option {
        width: var(--llm-mode-option-width);
        height: var(--llm-mode-option-height);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: none;
        border: none;
        border-radius: calc(var(--llm-mode-option-height) / 2);
        color: var(--boxel-light);
        font-weight: 600;
        font-size: var(--boxel-font-size-xs);
        letter-spacing: var(--boxel-lsp-sm);
        cursor: pointer;
        transition:
          background-color var(--boxel-transition),
          color var(--boxel-transition);
      }
      .llm-mode-option.selected {
        background: var(--boxel-highlight);
        color: var(--boxel-dark);
      }
      .llm-mode-option:disabled {
        opacity: 0.5;
      }
      .llm-mode-option-tooltip {
        max-width: 10rem;
      }
    </style>
  </template>

  @action
  private handleOptionClick(mode: LLMMode) {
    if (mode !== this.selected) {
      this.args.onChange(mode);
    }
  }
}

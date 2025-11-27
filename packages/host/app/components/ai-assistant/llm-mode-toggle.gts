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
  <template>
    <div class='llm-mode-toggle' ...attributes>
      <Tooltip @placement='top'>
        <:trigger>
          <button
            type='button'
            class='llm-mode-option {{if (eq @selected "ask") "selected"}}'
            data-test-llm-mode-option='ask'
            disabled={{@disabled}}
            {{on 'click' (fn this.handleOptionClick 'ask')}}
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
            class='llm-mode-option {{if (eq @selected "act") "selected"}}'
            data-test-llm-mode-option='act'
            disabled={{@disabled}}
            {{on 'click' (fn this.handleOptionClick 'act')}}
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
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--boxel-650);
        border-radius: var(--boxel-pill-radius, 999px);
        overflow: hidden;
        border-width: 0;
        box-shadow: none;
        padding: 1.5px 2px 2px 2px;
      }
      .llm-mode-option {
        flex: 1 1 0;
        background: none;
        border: none;
        border-radius: var(--boxel-border-radius);
        padding-block: 2px;
        color: var(--boxel-light);
        font: 700 var(--boxel-font-xs);
        cursor: pointer;
        transition:
          background 0.15s,
          color 0.15s;
      }
      .llm-mode-option.selected {
        background: var(--boxel-teal);
        color: var(--boxel-dark);
        height: 100%;
      }
      .llm-mode-option:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .llm-mode-option-tooltip {
        max-width: 160px;
      }
    </style>
  </template>

  @action
  private handleOptionClick(mode: LLMMode) {
    if (mode !== this.args.selected) {
      this.args.onChange(mode);
    }
  }
}

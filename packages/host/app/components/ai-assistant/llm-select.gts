import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import PillMenu from '@cardstack/host/components/pill-menu';
import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';

interface Signature {
  Args: {
    selected: string;
    options: string[];
    onChange: (selectedLLM: string) => void;
    disabled?: boolean;
    onExpand?: () => void;
    onCollapse?: () => void;
  };
  Element: HTMLElement;
}

export default class LLMSelect extends Component<Signature> {
  <template>
    <PillMenu
      class='llm-select'
      @onExpand={{@onExpand}}
      @onCollapse={{@onCollapse}}
      ...attributes
    >
      <:headerDetail>
        <div class='selected-llm-wrapper'>
          <span
            class='selected-llm'
            data-test-llm-select-selected={{@selected}}
          >
            {{this.displayName}}
          </span>
        </div>
      </:headerDetail>
      <:content>
        <ul class='llm-list'>
          {{#each @options as |option|}}
            <li
              class='llm-option {{if (eq @selected option) "selected"}}'
              data-test-llm-select-item={{option}}
              {{scrollIntoViewModifier
                (eq @selected option)
                container='llm-select'
                key=option
              }}
            >
              <button
                type='button'
                class='llm-button'
                {{on 'click' (fn this.handleOptionClick option)}}
              >
                {{option}}
              </button>
            </li>
          {{/each}}
        </ul>
      </:content>
    </PillMenu>
    <style scoped>
      .llm-select {
        background-color: transparent;
        box-shadow: none;
      }

      .selected-llm-wrapper {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      .selected-llm {
        color: var(--boxel-dark);
        font: 600 var(--boxel-font-xs);
      }

      .llm-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: var(--boxel-sp-xxxs);
        max-height: 300px;
        overflow-y: auto;
      }

      .llm-option {
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        border: 1px solid var(--boxel-400);
      }

      .llm-option:hover {
        border: 1px solid var(--boxel-dark);
      }

      .llm-option.selected {
        background-color: var(--boxel-teal);
      }

      .llm-button {
        width: 100%;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        text-align: left;
        background: none;
        border: none;
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-xs);
        cursor: pointer;
      }
    </style>
  </template>

  private get displayName() {
    return this.args.selected.split('/')[1] ?? this.args.selected;
  }

  @action
  private handleOptionClick(option: string) {
    this.args.onChange(option);
  }
}

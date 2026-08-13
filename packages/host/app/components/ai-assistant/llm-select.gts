import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import Check from '@cardstack/boxel-icons/check';

import { eq } from '@cardstack/boxel-ui/helpers';

import PillMenu from '@cardstack/host/components/pill-menu';
import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';

export interface LLMOption {
  id: string;
  modelId: string;
  name: string;
  // Glanceable cost tier ('Free' | '$' … '$$$$'); omitted when unknown.
  costTierLabel?: string;
}

interface Signature {
  Args: {
    selected: string;
    options: LLMOption[];
    onChange: (selectedLLM: string) => void;
    disabled?: boolean;
    onExpand?: () => void;
    onCollapse?: () => void;
  };
  Blocks: {
    footer: [];
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
          {{#if this.selectedCostTierLabel}}
            <span
              class='llm-cost'
              data-test-llm-cost-selected={{this.selectedCostTierLabel}}
            >
              {{this.selectedCostTierLabel}}
            </span>
          {{/if}}
        </div>
      </:headerDetail>
      <:content>
        <ul class='llm-list'>
          {{#each @options key='id' as |option|}}
            <li
              class='llm-option {{if (eq @selected option.id) "selected"}}'
              data-test-llm-select-item={{option.id}}
              {{scrollIntoViewModifier
                (eq @selected option.id)
                container='llm-select'
                key=option.id
              }}
            >
              <button
                type='button'
                class='llm-button'
                {{on 'click' (fn this.handleOptionClick option.id)}}
              >
                <span class='llm-name'>{{option.name}}</span>
                <span class='llm-meta'>
                  {{#if option.costTierLabel}}
                    <span
                      class='llm-cost'
                      data-test-llm-cost={{option.costTierLabel}}
                    >
                      {{option.costTierLabel}}
                    </span>
                  {{/if}}
                  {{#if (eq @selected option.id)}}
                    <Check class='selected-icon' />
                  {{/if}}
                </span>
              </button>
            </li>
          {{/each}}
          {{yield to='footer'}}
        </ul>
      </:content>
    </PillMenu>
    <style scoped>
      .llm-select {
        background-color: transparent;
        box-shadow: none;
      }

      .selected-llm-wrapper {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        overflow: hidden;
        min-width: 0;
      }

      .selected-llm {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-xs);
      }

      /* Cost tier chip ($…$$$$ / Free). Deliberately muted and distinct from
         the green per-token prices shown on the model cards. */
      .llm-cost {
        flex-shrink: 0;
        color: var(--boxel-450);
        font: 600 var(--boxel-font-xs);
        letter-spacing: 0.03em;
      }

      .llm-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: var(--boxel-sp-xxxs);
        max-height: 300px;
        overflow-y: auto;

        scroll-timeline: --pill-menu-content-scroll-timeline;
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

      .selected-icon {
        width: var(--boxel-font-size);
        height: auto;
        stroke-width: 3px;
      }

      .llm-button {
        width: 100%;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: none;
        border: none;
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-xs);
        cursor: pointer;

        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .llm-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        text-align: left;
      }

      .llm-meta {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }

      .llm-option.selected .llm-button {
        font-weight: 600;
      }
    </style>
  </template>

  private get selectedOption() {
    return this.args.options.find((o) => o.id === this.args.selected);
  }

  private get displayName() {
    return this.selectedOption?.name;
  }

  private get selectedCostTierLabel() {
    return this.selectedOption?.costTierLabel;
  }

  @action
  private handleOptionClick(option: string) {
    this.args.onChange(option);
  }
}

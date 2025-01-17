import type { TemplateOnlyComponent } from '@ember/component/template-only';
import Component from '@glimmer/component';

import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { CheckMark } from '@cardstack/boxel-ui/icons';

interface Signature {
  Args: {
    selected: string;
    options: string[];
    onChange: (selectedLLM: string) => void;
    disabled?: boolean;
  };
  Element: HTMLElement;
}

const LLMSelect: TemplateOnlyComponent<Signature> = <template>
  <BoxelSelect
    class='llm-select'
    @selected={{@selected}}
    @verticalPosition='above'
    @onChange={{@onChange}}
    @options={{@options}}
    @disabled={{@disabled}}
    @matchTriggerWidth={{false}}
    @selectedItemComponent={{component SelectedItem selected=@selected}}
    @dropdownClass='llm-select__dropdown'
    as |item|
  >
    <div class='item-container'>
      <div class='check-mark'>
        {{#if (eq @selected item)}}
          <CheckMark width='12' height='12' />
        {{/if}}
      </div>
      <span class='item' data-test-llm-select-item={{item}}>{{item}}</span>
    </div>
  </BoxelSelect>
  <style scoped>
    .llm-select {
      border: none;
      padding: 0;
      width: auto;
      flex: 1;
      padding-right: var(--boxel-sp-xxs);
      cursor: pointer;
      font:;
    }
    .llm-select :deep(.boxel-trigger) {
      padding: 0;
    }
    .llm-select :deep(.boxel-trigger-content) {
      flex: 1;
    }
    .llm-select[aria-disabled='true'],
    .llm-select[aria-disabled='true'] :deep(.boxel-trigger-content .llm-name) {
      background-color: var(--boxel-light);
      color: var(--boxel-500);
    }
    .item-container {
      display: grid;
      grid-template-columns: 12px 1fr;
      gap: var(--boxel-sp-xs);
      width: 100%;
    }
    .check-mark {
      height: 12px;
    }
    .item {
      overflow: hidden;
      text-overflow: ellipsis;
      text-wrap: nowrap;
      color: var(--boxel-dark);
      font: 500 var(--boxel-font-sm);
    }

    :global(
        .llm-select__dropdown .ember-power-select-option[aria-current='true']
      ) {
      background-color: var(--boxel-teal) !important;
    }
  </style>
</template>;

export default LLMSelect;

interface SelectedItemSignature {
  Args: {
    selected: string;
  };
  Element: HTMLDivElement;
}

class SelectedItem extends Component<SelectedItemSignature> {
  <template>
    <div class='selected'>
      <span data-test-llm-select-selected={{@selected}}>{{this.model}}</span>
    </div>

    <style scoped>
      .selected {
        display: grid;
        grid-template-columns: 1fr;
        width: 100%;
      }
      .selected span {
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-sm);
        text-align: right;
      }
    </style>
  </template>

  private get model() {
    return this.args.selected.split('/')[1] ?? this.args.selected;
  }
}

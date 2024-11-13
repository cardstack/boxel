import GlimmerComponent from '@glimmer/component';
import { BoxelMultiSelectBasic } from '@cardstack/boxel-ui/components';
import { FilterTrigger } from './filter-trigger';

interface FilterDropdownSignature {
  Element: HTMLDivElement;
  Args: {
    realmURLs: string[];
    options: any;
    selected: any;
    onChange: (value: any) => void;
    onClose: () => boolean | undefined;
  };
  Blocks: {
    default: [any];
  };
}

export class FilterDropdown extends GlimmerComponent<FilterDropdownSignature> {
  <template>
    <BoxelMultiSelectBasic
      class='multi-select'
      @options={{@options}}
      @selected={{@selected}}
      @onChange={{@onChange}}
      @triggerComponent={{FilterTrigger}}
      @searchEnabled={{true}}
      @initiallyOpened={{true}}
      @closeOnSelect={{false}}
      @onClose={{@onClose}}
      @matchTriggerWidth={{false}}
      ...attributes
      as |item|
    >
      {{yield item}}
    </BoxelMultiSelectBasic>
    <style scoped>
      .multi-select {
        border: none;
      }
    </style>
    {{! template-lint-disable require-scoped-style }}
    <style>
      .ember-power-select-dropdown.ember-basic-dropdown-content--below {
        border: 2px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}

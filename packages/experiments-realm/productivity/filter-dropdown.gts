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
      class='work-tracker-multi-select'
      @options={{@options}}
      @selected={{@selected}}
      @onChange={{@onChange}}
      @triggerComponent={{FilterTrigger}}
      @initiallyOpened={{true}}
      @searchEnabled={{true}}
      @searchField='name'
      @closeOnSelect={{false}}
      @onClose={{@onClose}}
      @matchTriggerWidth={{false}}
      ...attributes
      as |item|
    >
      <div class='filter-option'>{{yield item}}</div>
    </BoxelMultiSelectBasic>

    <style scoped>
      .work-tracker-multi-select {
        border: none;
      }
      .filter-option {
        width: 200px;
      }
    </style>
  </template>
}

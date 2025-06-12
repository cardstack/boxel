import GlimmerComponent from '@glimmer/component';
import { BoxelMultiSelectBasic } from '@cardstack/boxel-ui/components';
import { FilterTrigger } from './filter-trigger';

interface FilterDropdownSignature {
  Element: HTMLDivElement;
  Args: {
    searchField: string;
    realmURLs: string[];
    options: any;
    selected: any;
    onChange: (value: any) => void;
    onClose: () => boolean | undefined;
    isLoading?: boolean;
  };
  Blocks: {
    default: [any];
  };
}

export class FilterDropdown extends GlimmerComponent<FilterDropdownSignature> {
  <template>
    <BoxelMultiSelectBasic
      class='filter-multi-select'
      @options={{@options}}
      @selected={{@selected}}
      @onChange={{@onChange}}
      @triggerComponent={{component FilterTrigger isLoading=@isLoading}}
      @initiallyOpened={{true}}
      @searchEnabled={{true}}
      @searchField={{@searchField}}
      @closeOnSelect={{false}}
      @onClose={{@onClose}}
      @matchTriggerWidth={{false}}
      ...attributes
      as |item|
    >
      <div class='filter-option'>{{yield item}}</div>
    </BoxelMultiSelectBasic>

    <style scoped>
      .filter-multi-select {
        border: none;
      }
      .filter-option {
        width: 200px;
      }
    </style>
  </template>
}

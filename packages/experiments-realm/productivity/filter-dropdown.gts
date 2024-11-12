import { getCards } from '@cardstack/runtime-common';
import GlimmerComponent from '@glimmer/component';
import { BoxelMultiSelectBasic } from '@cardstack/boxel-ui/components';
import { ResolvedCodeRef } from '@cardstack/runtime-common';
import { FilterTrigger } from './filter-trigger';
import { action } from '@ember/object';

interface FilterDropdownSignature {
  Element: HTMLDivElement;
  Args: {
    options: any;
    selected: any;
    onChange: (value: any) => void;
  };
  Blocks: {
    default: [any];
  };
}
interface FilterDropdownCardSignature {
  Element: HTMLDivElement;
  Args: {
    codeRef: ResolvedCodeRef;
    realmURLs: string[];
    selected: any;
    onChange: (value: any) => void;
    onClose: () => boolean | undefined;
  };
  Blocks: {
    default: [any];
  };
}

export class FilterDropdownCard extends GlimmerComponent<FilterDropdownCardSignature> {
  get query() {
    return {
      filter: {
        type: this.args.codeRef,
      },
    };
  }
  cards = getCards(this.query, this.args.realmURLs); //load cards first

  get data() {
    if (!this.cards || this.args.codeRef === undefined) {
      return [];
    }
    return this.cards.instances;
  }

  @action onChange(value: any) {
    this.args.onChange(value);
  }

  matchById(item: any, selected: any) {
    return item.id === selected.id;
  }

  isSelected(item: any) {
    console.log('selected arr');
    console.log(this.args.selected);
    return this.args.selected.some((selectedItem: any) => {
      return this.matchById(item, selectedItem);
    });
  }

  <template>
    <BoxelMultiSelectBasic
      class='multi-select'
      @options={{this.data}}
      @selected={{@selected}}
      @onChange={{@onChange}}
      @triggerComponent={{FilterTrigger}}
      @searchEnabled={{true}}
      @initiallyOpened={{true}}
      @closeOnSelect={{false}}
      @onClose={{@onClose}}
      @matcher={{this.matchById}}
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
    <style>
      .ember-power-select-dropdown.ember-basic-dropdown-content--below {
        border: 2px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}

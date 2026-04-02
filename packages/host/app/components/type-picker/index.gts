import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    disableSelectAll?: boolean;
    options: PickerOption[];
    selected: PickerOption[];
    onChange: (selected: PickerOption[]) => void;
    label?: string;
    onSearchChange?: (term: string) => void;
    onLoadMore?: () => void;
    hasMore?: boolean;
    isLoading?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
    renderInPlace?: boolean;
  };
  Blocks: {};
}

export default class TypePicker extends Component<Signature> {
  @cached
  get selectAllOption() {
    let count =
      this.args.totalCount !== undefined
        ? this.args.totalCount
        : this.args.options.length;
    return {
      id: 'select-all',
      label: `Any Type (${count})`,
      shortLabel: `Any`,
      type: 'select-all',
      ...(this.args.disableSelectAll ? { disabled: true } : {}),
    };
  }

  get allOptions(): PickerOption[] {
    return [this.selectAllOption, ...this.args.options];
  }

  get selected(): PickerOption[] {
    return this.args.selected.length > 0
      ? this.args.selected
      : [this.selectAllOption];
  }

  get hasServerSearch(): boolean {
    return !!this.args.onSearchChange;
  }

  <template>
    <Picker
      @label={{if @label @label 'Type'}}
      @options={{this.allOptions}}
      @selected={{this.selected}}
      @onChange={{@onChange}}
      @searchPlaceholder='Search for a type'
      @maxSelectedDisplay={{3}}
      @renderInPlace={{if @renderInPlace true false}}
      @matchTriggerWidth={{false}}
      @onSearchTermChange={{@onSearchChange}}
      @disableClientSideSearch={{this.hasServerSearch}}
      @isLoading={{@isLoading}}
      @isLoadingMore={{@isLoadingMore}}
      @hasMore={{@hasMore}}
      @onLoadMore={{@onLoadMore}}
      data-test-type-picker
    />
  </template>
}

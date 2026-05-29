import Component from '@glimmer/component';
import { service } from '@ember/service';
import { cached } from '@glimmer/tracking';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

import {
  type ResolvedCodeRef,
  codeRefFromInternalKey,
  internalKeyFor,
} from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';
import type { TypeOption } from '@cardstack/host/resources/type-summaries';

export interface TypeFilter {
  options: TypeOption[];
  selected: ResolvedCodeRef[];
  onChange: (selected: ResolvedCodeRef[]) => void;
  onSearchChange: (term: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  totalCount: number;
  disableSelectAll: boolean;
  /** Whether to skip type-based filtering on recent cards */
  skipTypeFiltering: boolean;
}

interface Signature {
  Args: {
    filter: TypeFilter;
    label?: string;
    destination?: string;
  };
  Blocks: {};
}

export default class TypePicker extends Component<Signature> {
  @service declare private network: NetworkService;

  @cached
  get selectAllOption(): PickerOption {
    let count =
      this.args.filter.totalCount !== undefined
        ? this.args.filter.totalCount
        : this.args.filter.options.length;
    return {
      id: 'select-all',
      label: `Any Type (${count})`,
      shortLabel: `Any`,
      type: 'select-all',
      ...(this.args.filter.disableSelectAll ? { disabled: true } : {}),
    };
  }

  private get pickerOptions(): PickerOption[] {
    const lockOptions = this.args.filter.disableSelectAll;
    const options: PickerOption[] = this.args.filter.options.map((opt) => ({
      id: opt.id,
      label: opt.displayName,
      tooltip: opt.id,
      icon: opt.icon,
      type: 'option' as const,
      ...(lockOptions ? { disabled: true } : {}),
    }));
    return [this.selectAllOption, ...options];
  }

  private get pickerSelected(): PickerOption[] {
    const selectedKeys = new Set(
      this.args.filter.selected.map((ref) =>
        internalKeyFor(ref, undefined, this.network.virtualNetwork),
      ),
    );
    if (selectedKeys.size === 0) {
      return [this.selectAllOption];
    }
    return this.pickerOptions.filter(
      (opt) => opt.type !== 'select-all' && selectedKeys.has(opt.id),
    );
  }

  private get hasServerSearch(): boolean {
    return !!this.args.filter.onSearchChange;
  }

  private onChange = (selected: PickerOption[]) => {
    const refs = selected
      .filter((opt) => opt.type !== 'select-all')
      .map((opt) => codeRefFromInternalKey(opt.id))
      .filter((ref): ref is ResolvedCodeRef => ref !== undefined);
    this.args.filter.onChange(refs);
  };

  <template>
    <Picker
      @label={{if @label @label 'Type'}}
      @options={{this.pickerOptions}}
      @selected={{this.pickerSelected}}
      @onChange={{this.onChange}}
      @searchPlaceholder='Search for a type'
      @maxSelectedDisplay={{3}}
      @renderInPlace={{false}}
      @destination={{@destination}}
      @matchTriggerWidth={{false}}
      @onSearchTermChange={{@filter.onSearchChange}}
      @disableClientSideSearch={{this.hasServerSearch}}
      @isLoading={{@filter.isLoading}}
      @isLoadingMore={{@filter.isLoadingMore}}
      @hasMore={{@filter.hasMore}}
      @onLoadMore={{@filter.onLoadMore}}
      data-test-type-picker
    />
  </template>
}

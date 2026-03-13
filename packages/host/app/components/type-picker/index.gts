import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import {
  LoadingIndicator,
  Picker,
  type PickerOption,
} from '@cardstack/boxel-ui/components';

let infiniteScroll = modifier(
  (
    element: Element,
    [onLoadMore, isLoadingMore]: [
      (() => void) | undefined,
      boolean | undefined,
    ],
    { enabled }: { enabled?: boolean },
  ) => {
    if (!enabled || !onLoadMore) {
      return;
    }

    let optionsList = element
      .closest('.ember-basic-dropdown-content')
      ?.querySelector('.ember-power-select-options');
    if (!optionsList) {
      return;
    }

    let handleScroll = () => {
      if (isLoadingMore) {
        return;
      }
      let { scrollTop, scrollHeight, clientHeight } = optionsList as Element;
      if (scrollTop + clientHeight >= scrollHeight - 50) {
        onLoadMore();
      }
    };

    optionsList.addEventListener('scroll', handleScroll);
    return () => optionsList!.removeEventListener('scroll', handleScroll);
  },
);

interface TypePickerAfterOptionsSignature {
  Args: {
    // ember-power-select passes the select API; we only need extra
    select: { extra?: Record<string, any> };
  };
}

class TypePickerAfterOptions extends Component<TypePickerAfterOptionsSignature> {
  get hasMore(): boolean {
    return !!this.args.select.extra?.hasMore;
  }

  get isLoadingMore(): boolean {
    return !!this.args.select.extra?.isLoadingMore;
  }

  get onLoadMore(): (() => void) | undefined {
    return this.args.select.extra?.onLoadMore;
  }

  <template>
    {{#if this.hasMore}}
      <div
        class='type-picker-infinite-scroll'
        {{infiniteScroll
          this.onLoadMore
          this.isLoadingMore
          enabled=this.hasMore
        }}
        data-test-type-picker-infinite-scroll
      >
        {{#if this.isLoadingMore}}
          <div class='type-picker-loading' data-test-type-picker-loading>
            <LoadingIndicator class='type-picker-loading-spinner' />
          </div>
        {{/if}}
      </div>
    {{/if}}

    {{! template-lint-disable require-scoped-style }}
    <style>
      .type-picker-infinite-scroll {
        min-height: 1px;
      }
      .type-picker-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp-xxs) 0;
      }
      .type-picker-loading-spinner {
        width: 20px;
        height: 20px;
      }
    </style>
  </template>
}

interface Signature {
  Args: {
    options: PickerOption[];
    selected: PickerOption[];
    onChange: (selected: PickerOption[]) => void;
    label?: string;
    onSearchChange?: (term: string) => void;
    onLoadMore?: () => void;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
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

  get pickerExtra(): Record<string, unknown> {
    return {
      onLoadMore: this.args.onLoadMore,
      hasMore: this.args.hasMore,
      isLoadingMore: this.args.isLoadingMore,
    };
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
      @maxSelectedDisplay={{3}}
      @renderInPlace={{false}}
      @matchTriggerWidth={{false}}
      @onSearchTermChange={{@onSearchChange}}
      @disableClientSideSearch={{this.hasServerSearch}}
      @afterOptionsComponent={{component TypePickerAfterOptions}}
      @extra={{this.pickerExtra}}
      data-test-type-picker
    />
  </template>
}

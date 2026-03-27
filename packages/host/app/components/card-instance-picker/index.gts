import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    options: PickerOption[];
    selected: PickerOption[];
    onChange: (selected: PickerOption[]) => void;
    label?: string;
    maxSelectedDisplay?: number;
    placeholder?: string;
  };
  Blocks: {};
  Element: HTMLElement;
}

export default class CardInstancePicker extends Component<Signature> {
  @cached
  get selectAllOption(): PickerOption {
    return {
      id: 'select-all',
      label: `Select All (${this.args.options.length})`,
      shortLabel: 'All',
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

  <template>
    <Picker
      @label={{if @label @label 'Instances'}}
      @options={{this.allOptions}}
      @selected={{this.selected}}
      @onChange={{@onChange}}
      @placeholder={{@placeholder}}
      @maxSelectedDisplay={{if @maxSelectedDisplay @maxSelectedDisplay 3}}
      @renderInPlace={{false}}
      @matchTriggerWidth={{false}}
      data-test-card-instance-picker
      ...attributes
    />
  </template>
}

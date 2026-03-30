import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

interface Signature {
  Args: {
    options: PickerOption[];
    selected: PickerOption[];
    onChange: (selected: PickerOption[]) => void;
    label?: string;
  };
  Blocks: {};
}

export default class TypePicker extends Component<Signature> {
  @cached
  get selectAllOption() {
    return {
      id: 'select-all',
      label: `Any Type (${this.args.options.length})`,
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

  <template>
    <Picker
      @label={{if @label @label 'Type'}}
      @options={{this.allOptions}}
      @selected={{this.selected}}
      @onChange={{@onChange}}
      @searchPlaceholder='Search for a type'
      @maxSelectedDisplay={{3}}
      @renderInPlace={{false}}
      @matchTriggerWidth={{false}}
      data-test-type-picker
    />
  </template>
}

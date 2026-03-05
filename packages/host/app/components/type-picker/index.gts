import Component from '@glimmer/component';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

const SELECT_ALL_OPTION: PickerOption = {
  id: 'select-all',
  name: 'Any Type',
  type: 'select-all',
};

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
  get allOptions(): PickerOption[] {
    return [SELECT_ALL_OPTION, ...this.args.options];
  }

  get selected(): PickerOption[] {
    return this.args.selected.length > 0
      ? this.args.selected
      : [SELECT_ALL_OPTION];
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
      data-test-type-picker
    />
  </template>
}

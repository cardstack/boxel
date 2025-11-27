import { Component } from './card-api';
import StringField from './string';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { DEFAULT_LLM_ID_TO_NAME } from '@cardstack/runtime-common';

const LLM_MODEL_OPTIONS = Object.entries(DEFAULT_LLM_ID_TO_NAME).map(
  ([value, label]) => ({ value, label }),
);

class LLMModelEdit extends Component<typeof LLMModelField> {
  options = LLM_MODEL_OPTIONS;

  get selected() {
    let current = this.args.model;
    if (!current) {
      return null;
    }
    return (
      this.options.find((option) => option.value === current) ?? {
        value: current,
        label: current,
      }
    );
  }

  onSelect = (option: { value: string; label: string } | null) => {
    this.args.set?.(option?.value ?? null);
  };

  <template>
    <BoxelSelect
      @placeholder='Select LLM model'
      @options={{this.options}}
      @selected={{this.selected}}
      @onChange={{this.onSelect}}
      @disabled={{if @canEdit false true}}
      as |option|
    >
      {{option.label}}
    </BoxelSelect>
  </template>
}

export default class LLMModelField extends StringField {
  static displayName = 'LLM Model';
  static edit = LLMModelEdit;
}

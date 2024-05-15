import { not } from '@cardstack/boxel-ui/helpers';
import { Component } from './card-api';
import StringField from './string';
import { BoxelInput } from '@cardstack/boxel-ui/components';

export default class TextAreaCard extends StringField {
  static displayName = 'TextArea';
  static edit = class Edit extends Component<typeof this> {
    set = (val: string | undefined) => {
      this.args.model.value = val;
    };
    <template>
      <BoxelInput
        class='boxel-text-area'
        @value={{@model.value}}
        @onInput={{this.set}}
        @type='textarea'
        @disabled={{not @canEdit}}
      />
    </template>
  };
}

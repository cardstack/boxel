import { not } from '@cardstack/boxel-ui/helpers';
import { Component } from './card-api';
import StringField from './string';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import AlignLeftIcon from '@cardstack/boxel-icons/align-left';

export default class TextAreaCard extends StringField {
  static displayName = 'TextArea';
  static icon = AlignLeftIcon;
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        class='boxel-text-area'
        @value={{@model}}
        @onInput={{@set}}
        @type='textarea'
        @disabled={{not @canEdit}}
      />
    </template>
  };
}

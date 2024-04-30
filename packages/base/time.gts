import { Component } from './card-api';
import StringField from './string';
import { BoxelInput } from '@cardstack/boxel-ui/components';

export default class TimeCard extends StringField {
  static displayName = 'Time';
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{@model}}
        @onInput={{@set}}
        @type='time'
      />
    </template>
  };
}

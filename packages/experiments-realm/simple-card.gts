import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { BoxelInput } from '@cardstack/boxel-ui/components';

class StringFieldWithValue extends StringCard {
  static displayName = 'StringFieldWithValue';

  static edit = class Edit extends Component<typeof StringFieldWithValue> {
    <template>
      {{@model}}
      <BoxelInput @value={{@model}} @onInput={{@set}} />
    </template>
  };
}

export class SimpleCard extends CardDef {
  static displayName = 'SimpleCard';
  @field name = contains(StringFieldWithValue);

  static edit = class Edit extends Component<typeof this> {
    <template>
      <@fields.name />
    </template>
  };
}

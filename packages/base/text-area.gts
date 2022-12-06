import { Component } from './card-api';
import StringCard from './string';
import BoxelInput from './boxel-ui/components/input';

export default class TextAreaCard extends StringCard {
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput @value={{@model}} @onInput={{@set}} @multiline={{true}} />
    </template>
  }
}

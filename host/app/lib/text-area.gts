import { Component } from 'runtime-spike/lib/card-api';
import StringCard from './string';
import { on } from '@ember/modifier';
import { pick } from './pick';

export default class TextAreaCard extends StringCard {
  static edit = class Edit extends Component<typeof this> {
    <template>
      <textarea value={{@model}} {{on "input" (pick "target.value" @set) }} />
    </template>
  }
}
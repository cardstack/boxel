import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import {
  CardDef,
  Component as CardComponent,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// The universal interactive-card pattern: `@tracked` local state
// declared directly inside the `static isolated = class …` format-class
// expression. Fires on basically every interactive card, so parse must
// accept it.
export class Toggle extends CardDef {
  static displayName = 'Toggle';
  @field label = contains(StringField);
  static isolated = class Isolated extends CardComponent<typeof Toggle> {
    @tracked open = false;
    toggle = () => {
      this.open = !this.open;
    };
    <template>
      <button type='button' {{on 'click' this.toggle}}>{{@model.label}}</button>
      {{#if this.open}}<p>open</p>{{/if}}
    </template>
  };
}

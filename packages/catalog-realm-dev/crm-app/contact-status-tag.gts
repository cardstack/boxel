import {
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from 'https://cardstack.com/base/card-api';
import ColorField from 'https://cardstack.com/base/color';

import ContactIcon from '@cardstack/boxel-icons/contact';

import { StatusPill } from './components/status-pill';

export class StatusTagField extends FieldDef {
  static icon = ContactIcon;
  @field label = contains(StringField);
  @field lightColor = contains(ColorField);
  @field darkColor = contains(ColorField);

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{#if @model.label}}
        <StatusPill
          @label={{@model.label}}
          @icon={{@model.constructor.icon}}
          @iconDarkColor={{@model.darkColor}}
          @iconLightColor={{@model.lightColor}}
        />
      {{/if}}
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      {{! Intentionally do not allow edit template bcos we are using a pattern where the subclass definition determines the value of the field}}
      {{#if @model.label}}
        <StatusPill
          @label={{@model.label}}
          @icon={{@model.constructor.icon}}
          @iconDarkColor={{@model.darkColor}}
          @iconLightColor={{@model.lightColor}}
        />
      {{/if}}
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.label}}
        <StatusPill
          @label={{@model.label}}
          @icon={{@model.constructor.icon}}
          @iconDarkColor={{@model.darkColor}}
          @iconLightColor={{@model.lightColor}}
        />
      {{/if}}
    </template>
  };
}

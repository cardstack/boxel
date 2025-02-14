import {
  CardDef,
  field,
  StringField,
  contains,
} from 'https://cardstack.com/base/card-api';

export class University extends CardDef {
  static displayName = 'University';
  @field name = contains(StringField);
  @field location = contains(StringField);
}

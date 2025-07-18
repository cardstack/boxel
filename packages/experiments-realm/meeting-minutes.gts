import {
  CardDef,
  contains,
  field,
  StringField,
} from 'https://cardstack.com/base/card-api';

export class MeetingMinutes extends CardDef {
  static displayName = 'Meeting Minutes';
  @field name = contains(StringField);
  @field company = contains(StringField);
}

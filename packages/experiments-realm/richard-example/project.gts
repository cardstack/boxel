import {
  CardDef,
  field,
  StringField,
  contains,
} from 'https://cardstack.com/base/card-api';

export class Project extends CardDef {
  static displayName = 'Project';

  @field name = contains(StringField);
  @field description = contains(StringField);
}

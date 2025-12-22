import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Task extends CardDef {
  static displayName = 'Task';

  @field taskName = contains(StringField);
  @field description = contains(StringField);
  @field assignee = contains(StringField);
  @field status = contains(StringField);
}

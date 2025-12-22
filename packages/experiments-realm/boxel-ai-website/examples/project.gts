import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Project extends CardDef {
  static displayName = 'Project';

  @field projectName = contains(StringField);
  @field summary = contains(StringField);
  @field status = contains(StringField);
  @field dueDate = contains(StringField);
}

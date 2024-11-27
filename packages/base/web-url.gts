import { FieldDef, contains, field } from './card-api';
import StringField from './string';

export class WebUrl extends FieldDef {
  static displayName = 'Web URL';
  @field value = contains(StringField);
}

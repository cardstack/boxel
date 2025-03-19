import { CardDef, field, contains, StringField } from '../card-api';
import TextAreaField from '../text-area';

export class License extends CardDef {
  static displayName = 'License';
  @field name = contains(StringField);
  @field content = contains(TextAreaField);
}

// Expected output for basic formatting
import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}

// Expected output for import formatting
import StringField from 'https://cardstack.com/base/string';
import EmailField from 'https://cardstack.com/base/email';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
  @field email = contains(EmailField);
}

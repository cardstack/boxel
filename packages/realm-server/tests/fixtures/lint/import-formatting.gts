// Test fixture for import statement formatting
import { CardDef } from 'https://cardstack.com/base/card-api';
import { StringField } from 'https://cardstack.com/base/string';
import { EmailField } from 'https://cardstack.com/base/email';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  @field email = contains(EmailField);
}

// Expected output for malformed syntax (ESLint fixes applied, but prettier failed)
import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  // Malformed syntax that prettier cannot parse
  @field }{ invalid
}

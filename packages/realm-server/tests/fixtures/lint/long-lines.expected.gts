// Expected output for long lines
import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field longPropertyName = contains(StringField, {
    description: 'This is a very long description that might need wrapping',
  });
}

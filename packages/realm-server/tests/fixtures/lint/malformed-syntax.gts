// Test fixture for malformed syntax that prettier cannot parse
import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
  // Malformed syntax that prettier cannot parse
  @field }{ invalid
}

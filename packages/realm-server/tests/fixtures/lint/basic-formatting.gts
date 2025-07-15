// Test fixture for basic formatting with indentation issues
import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}

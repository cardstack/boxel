import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import SillyNumberField from './silly-number';

export class Dog extends CardDef {
  @field firstName = contains(StringField);
  @field numberOfTreats = contains(SillyNumberField);
}

import { contains, field, CardDef } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

import SillyNumberField from './silly-number';

export class Dog extends CardDef {
  @field cardTitle = contains(StringField);
  @field firstName = contains(StringField);
  @field numberOfTreats = contains(SillyNumberField);
}

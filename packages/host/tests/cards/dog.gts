import { contains, field } from 'https://cardstack.com/base/card-api';
import CardDef from 'https://cardstack.com/base/card-def';
import StringCard from 'https://cardstack.com/base/string';

import SillyNumberField from './silly-number';

export class Dog extends CardDef {
  @field firstName = contains(StringCard);
  @field numberOfTreats = contains(SillyNumberField);
}

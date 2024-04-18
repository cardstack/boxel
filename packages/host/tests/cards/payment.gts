import {
  contains,
  field,
  FieldDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Chain } from './chain';

export class Payment extends FieldDef {
  @field chain = linksTo(Chain);
  @field address = contains(StringField);
}

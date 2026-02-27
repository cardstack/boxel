import {
  contains,
  field,
  FieldDef,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

import { Chain } from './chain';

export class Payment extends FieldDef {
  @field chain = linksTo(Chain);
  @field address = contains(StringField);
}

import { contains, field, linksTo } from 'https://cardstack.com/base/card-api';
import FieldDef from 'https://cardstack.com/base/field-def';
import StringCard from 'https://cardstack.com/base/string';

import { Chain } from './chain';

export class Payment extends FieldDef {
  @field chain = linksTo(Chain);
  @field address = contains(StringCard);
}

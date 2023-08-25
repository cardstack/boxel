import {
  contains,
  field,
  CardDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Chain } from './chain';

export class Payment extends CardDef {
  @field chain = linksTo(Chain);
  @field address = contains(StringCard);
}

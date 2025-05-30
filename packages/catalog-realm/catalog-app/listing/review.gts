import {
  CardDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { Listing } from './listing';

export class Review extends CardDef {
  static displayName = 'Review';
  static headerColor = '#00ebac';
  @field score = contains(NumberField);
  @field comment = contains(MarkdownField);
  @field listing = linksTo(() => Listing);
}

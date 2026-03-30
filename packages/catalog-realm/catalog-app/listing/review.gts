import {
  CardDef,
  field,
  contains,
  linksTo,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import MarkdownField from '@cardstack/base/markdown';

import { Listing } from './listing';

export class Review extends CardDef {
  static displayName = 'Review';
  static headerColor = '#00ebac';
  @field score = contains(NumberField);
  @field comment = contains(MarkdownField);
  @field listing = linksTo(() => Listing);
}

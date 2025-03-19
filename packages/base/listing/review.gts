import { CardDef, field, contains, linksTo } from '../card-api';
import NumberField from '../number';
import MarkdownField from '../markdown';
import { Listing } from './listing';

export class Review extends CardDef {
  static displayName = 'Review';
  @field score = contains(NumberField);
  @field comment = contains(MarkdownField);
  @field listing = linksTo(() => Listing);
}

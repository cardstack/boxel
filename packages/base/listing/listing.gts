import {
  contains,
  field,
  CardDef,
  linksToMany,
  StringField,
  linksTo,
} from '../card-api';
import MarkdownField from '../markdown';

import { Spec } from '../spec';
import { Publisher } from './publisher';
import { Category, Tag } from './category';
import { License } from './license';

export class Listing extends CardDef {
  static displayName = 'Listing';
  @field name = contains(StringField);
  @field summary = contains(MarkdownField);
  @field specs = linksToMany(() => Spec);
  @field publisher = linksTo(() => Publisher);
  @field categories = linksToMany(() => Category);
  @field tags = linksToMany(() => Tag);
  @field license = linksTo(() => License);
  //   @field pricing = contains(PricingField)
  //   @field images = containsMany(StringField) // thumbnailURLs
}

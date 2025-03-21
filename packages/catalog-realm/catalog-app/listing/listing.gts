import {
  contains,
  field,
  CardDef,
  linksToMany,
  StringField,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { Spec } from 'https://cardstack.com/base/spec';
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

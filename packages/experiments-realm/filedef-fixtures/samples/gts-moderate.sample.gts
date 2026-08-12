import {
  CardDef,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import FileDef from 'https://cardstack.com/base/file-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

export function readingTimeLabel(words: number): string { // A single-class module foregrounds its callable export in fitted
  return `${Math.max(1, Math.ceil(words / 220))} min read`;
}

export class ArticleCard extends CardDef { // One CardDef, several meaningful fields
  static displayName = 'Editorial Article';
  @field title = contains(StringField);
  @field tags = containsMany(StringField);
  @field wordCount = contains(NumberField);
  @field source = linksTo(() => FileDef);
}

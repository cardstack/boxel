import {
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';

export class FeatureTileField extends FieldDef {
  static displayName = 'Feature Tile';

  @field tileNumber = contains(StringField);
  @field headline = contains(StringField);
  @field body = contains(StringField);
  @field linkedCard = linksTo(() => CardDef);
  @field accentColor = contains(ColorField);
}

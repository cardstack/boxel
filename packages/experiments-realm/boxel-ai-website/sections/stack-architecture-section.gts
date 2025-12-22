import {
  // Component,
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';

import { SectionCard } from './section-card';

class FeatureTileField extends FieldDef {
  static displayName = 'Feature Tile';

  @field tileNumber = contains(StringField);
  @field headline = contains(StringField);
  @field body = contains(StringField);
  @field linkedCard = linksTo(() => CardDef);
  @field accentColor = contains(ColorField);
}

export class StackArchitectureSection extends SectionCard {
  static displayName = 'Stack Architecture';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field tiles = containsMany(FeatureTileField);

  /** Template Features:
   * 2×2 tile grid (or horizontal scroll variant)
   * Each tile has inline diagram visualization
   * Accent glow on hover
   * Bullet points with colored dots
   */
}

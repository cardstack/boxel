import {
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { SectionCard } from './section-card';

class ModelChipField extends FieldDef {
  static displayName = 'Model Chip';

  @field chipIcon = contains(StringField);
  @field chipName = contains(StringField);
}

class ModelCategoryField extends FieldDef {
  static displayName = 'Model Category';

  @field categoryIcon = contains(StringField);
  @field categoryLabel = contains(StringField);
  @field models = containsMany(ModelChipField);
  @field modelCount = contains(StringField);
  @field accentColor = contains(StringField);
}

export class ModelsSection extends SectionCard {
  static displayName = 'Models Section';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field openRouterModels = containsMany(ModelChipField);
  @field replicateCategories = containsMany(ModelCategoryField);
  @field footerNote = contains(StringField);

  /** Template Features:
   * Model sources grid (OpenRouter + Replicate)
   * Chips with model counts
   * Category cards with accent colors
   */
}

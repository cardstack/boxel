import {
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { SectionCard } from './section-card';
import {
  CatalogItemField,
  CategoryPillField,
} from '../fields/catalog-item-field';

export class CatalogSection extends SectionCard {
  static displayName = 'Catalog Section';

  @field sectionNumber = contains(StringField);
  @field sectionLabel = contains(StringField);
  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field categories = containsMany(CategoryPillField);
  @field catalogItems = containsMany(CatalogItemField);
  @field themeSwatches = containsMany(StringField);

  /** Template Features:
   * Catalog header bar with tabs
   * Category pill filters
   * 4×2 catalog grid
   * Hover overlay with "Remix" and "Preview" buttons
   * Theme chooser strip at bottom
   */
}

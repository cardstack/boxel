import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Section } from '../components/section';
import { SectionCard } from './section-card';
import {
  CatalogItemField,
  CategoryPillField,
} from '../fields/catalog-item-field';

export class CatalogSection extends SectionCard {
  static displayName = 'Catalog Section';

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

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section class='catalog-section' as |s|>
        <s.Header
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
          @type='row'
        />

        {{#if @model.categories.length}}
          <s.Row>
            <@fields.categories class='catalog-categories' />

            {{#if @model.catalogItems.length}}
              <s.Grid @gridColWidth='14rem' @gridGap='1.5rem'>
                <@fields.catalogItems />
              </s.Grid>
            {{/if}}
          </s.Row>
        {{/if}}
      </Section>

      <style scoped>
        .catalog-categories {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 2rem;
        }
      </style>
    </template>
  };
}

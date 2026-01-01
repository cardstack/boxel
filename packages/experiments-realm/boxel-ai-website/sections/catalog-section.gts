import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { cssVar } from '@cardstack/boxel-ui/helpers';

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
          </s.Row>
        {{/if}}

        {{#if @model.catalogItems.length}}
          <s.Grid @gridColWidth='14rem' @gridGap='1.5rem'>
            <@fields.catalogItems />
          </s.Grid>
        {{/if}}

        {{#if @model.themeSwatches.length}}
          <div class='catalog-swatches section-layout-row'>
            {{#each @model.themeSwatches as |swatch|}}
              <span
                aria-label='Theme swatch'
                class='catalog-swatch'
                style={{cssVar swatch-color=swatch}}
              ></span>
            {{/each}}
          </div>
        {{/if}}
      </Section>

      <style scoped>
        .catalog-section {
          --card-width: 14rem;
        }
        .catalog-categories {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .catalog-swatches {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .catalog-swatch {
          width: 2.5rem;
          height: 0.5rem;
          border-radius: 999px;
          background: var(--swatch-color, var(--border));
          border: 1px solid var(--border);
        }
        :deep(.catalog-tag) {
          display: inline-flex;
          align-items: center;
          padding: 0.3rem 0.75rem;
          border-radius: 0.25rem;
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--boxel-slate);
          background: rgba(0, 255, 186, 0.15);
        }
        :deep(.catalog-price) {
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-weight: 700;
          color: var(--cardstack-purple);
        }
        :deep(.catalog-price.is-paid) {
          color: var(--boxel-slate);
        }
      </style>
    </template>
  };
}

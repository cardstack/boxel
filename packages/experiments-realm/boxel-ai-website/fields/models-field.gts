import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Pill, CardContainer } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

import { SectionCardComponent } from '../components/section';

class ModelChipField extends FieldDef {
  static displayName = 'Model Chip';

  @field chipIcon = contains(StringField);
  @field chipName = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: ModelChipField) {
      return this.chipName;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <Pill class='model-chip'>
        {{#if @model.chipIcon}}
          <span aria-hidden='true'>{{@model.chipIcon}}</span>
        {{/if}}
        {{@model.chipName}}
      </Pill>

      <style scoped>
        .model-chip {
          display: inline-flex;
          gap: 0.35rem;
          align-items: center;
          background: rgba(0, 255, 186, 0.12);
          color: var(--boxel-slate);
          border: 1px solid rgba(0, 255, 186, 0.35);
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: 0.75rem;
          padding: 0.35rem 0.75rem;
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}

class ModelCategoryField extends FieldDef {
  static displayName = 'Model Category';

  @field categoryIcon = contains(StringField);
  @field categoryLabel = contains(StringField);
  @field models = containsMany(ModelChipField);
  @field modelCount = contains(StringField);
  @field accentColor = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: ModelCategoryField) {
      return this.categoryLabel;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer
        class='model-category'
        style={{cssVar accent-color=@model.accentColor}}
      >
        <div class='category-header'>
          {{#if @model.categoryIcon}}
            <span class='category-icon' aria-hidden='true'>
              {{@model.categoryIcon}}
            </span>
          {{/if}}
          <div class='category-meta'>
            <span class='category-label'>{{@model.categoryLabel}}</span>
            {{#if @model.modelCount}}
              <span class='category-count'>{{@model.modelCount}}</span>
            {{/if}}
          </div>
        </div>

        {{#if @model.models.length}}
          <div class='category-chips'>
            <@fields.models />
          </div>
        {{/if}}
      </CardContainer>

      <style scoped>
        .model-category {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          border-color: var(--accent-color, var(--border));
          background: var(--card, var(--boxel-light));
        }
        .category-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .category-icon {
          font-size: 1.1rem;
        }
        .category-label {
          display: block;
          font-weight: 700;
          color: var(--foreground, var(--boxel-slate));
          letter-spacing: -0.01em;
        }
        .category-count {
          display: block;
          font-size: 0.8rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .category-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}

export class ModelsField extends FieldDef {
  static displayName = 'Models';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field openRouterModels = containsMany(ModelChipField);
  @field replicateCategories = containsMany(ModelCategoryField);
  @field replicateModels = containsMany(ModelChipField, {
    computeVia: function (this: ModelsField) {
      return (this.replicateCategories ?? [])
        .map((category) => category?.models ?? [])
        .flat();
    },
  });
  @field footerNote = contains(StringField);

  /** Template Features:
   * Model sources grid (OpenRouter + Replicate)
   * Chips with model counts
   * Category cards with accent colors
   */

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <SectionCardComponent
        class='models-card'
        @badgeLabel='Models'
        @title={{@model.headline}}
        @text={{@model.subheadline}}
      >
        <:default>
          <div>
            {{#if @model.openRouterModels.length}}
              <@fields.openRouterModels class='model-categories' />
            {{/if}}

            {{#if @model.replicateCategories.length}}
              <@fields.replicateModels class='model-categories' />
            {{/if}}
          </div>
        </:default>

        <:footer>
          {{#if @model.footerNote}}
            <p><small class='models-footer'>{{@model.footerNote}}</small></p>
          {{/if}}
        </:footer>
      </SectionCardComponent>

      <style scoped>
        .model-categories {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .models-footer {
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}

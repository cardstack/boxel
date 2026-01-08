import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { cssVar } from '@cardstack/boxel-ui/helpers';

import { SectionCardComponent } from '../components/section';
import { Tag } from '../components/tag';

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
      {{#if @model.chipName}}
        <Tag @icon={{@model.chipIcon}} @label={{@model.chipName}} />
      {{/if}}
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
      {{#if @model.models.length}}
        <@fields.models
          class='category-models'
          style={{cssVar accent-color=@model.accentColor}}
        />
      {{/if}}

      <style scoped>
        .category-models {
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
              <@fields.openRouterModels
                class='model-categories'
                style={{cssVar accent-color='var(--boxel-teal)'}}
              />
            {{/if}}

            {{#if @model.replicateCategories.length}}
              <@fields.replicateCategories class='model-categories' />
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
        }
        .model-categories + .model-categories {
          margin-top: 0.75rem;
        }
        .models-footer {
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}

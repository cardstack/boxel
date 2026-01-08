import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';
import enumField from 'https://cardstack.com/base/enum';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { cn, cssVar } from '@cardstack/boxel-ui/helpers';

import { Badge } from '../components/badge';
import { Tag } from '../components/tag';

export class CatalogItemField extends FieldDef {
  static displayName = 'Catalog Item';

  @field itemIcon = contains(StringField);
  @field itemTitle = contains(StringField);
  @field itemDescription = contains(StringField);
  @field itemPrice = contains(StringField);
  @field remixCount = contains(StringField);
  @field linkedCard = linksTo(() => CardDef);
  @field badge = contains(
    enumField(StringField, { options: ['app', 'skill', 'theme'] }),
  );
  @field isHighlighted = contains(BooleanField);
  @field accentColor = contains(
    enumField(StringField, {
      options: ['primary', 'secondary', 'accent'],
    }),
  );

  static embedded = class Embedded extends Component<typeof this> {
    private get isPaid() {
      let price = this.args.model?.itemPrice;
      if (!price) return false;

      return price.toLowerCase() !== 'free';
    }

    private get accentColor() {
      return this.args.model?.accentColor ?? 'primary';
    }

    <template>
      <CardContainer
        class={{cn
          'catalog-item-card'
          (if @model.isHighlighted 'catalog-item-card--highlight')
        }}
        style={{cssVar accent-color=@model.accentColor}}
      >
        {{#if @model.badge}}
          <Badge
            class='catalog-item-card-badge'
            @label={{@model.badge}}
            @variant='{{this.accentColor}}-inverse'
          />
        {{/if}}

        <h4 class='catalog-title'>{{#if @model.itemIcon}}
            <span aria-hidden='true' class='catalog-icon'>
              {{@model.itemIcon}}
            </span>
          {{/if}}
          {{@model.itemTitle}}</h4>
        <p class='catalog-description'>{{@model.itemDescription}}</p>

        <div class='catalog-meta'>
          {{#if @model.remixCount.length}}
            <Tag
              class='catalog-item-card-tag'
              @label={{@model.remixCount}}
              @variant={{this.accentColor}}
            />
          {{/if}}
          {{#if @model.itemPrice.length}}
            <span class={{cn 'catalog-price' (if this.isPaid 'is-paid')}}>
              {{@model.itemPrice}}
            </span>
          {{/if}}
        </div>
      </CardContainer>

      <style scoped>
        .catalog-item-card {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.75rem;
          padding: 1.5rem;
          background: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
          transition:
            transform 0.25s ease,
            box-shadow 0.25s ease,
            border-color 0.25s ease;
        }
        .catalog-item-card:hover {
          --hover-color: var(--brand-secondary);
          transform: translateY(-6px) scale(1.01);
          border-color: var(--hover-color);
          box-shadow:
            0 16px 32px -16px rgba(0, 0, 0, 0.24),
            0 12px 28px -20px
              color-mix(in oklab, var(--hover-color) 3%, transparent);
        }
        .catalog-item-card.catalog-item-card--highlight {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--accent-foreground);
          box-shadow:
            0 24px 48px -24px rgba(0, 0, 0, 0.35),
            0 0 0 1px rgba(0, 0, 0, 0.05);
        }
        .catalog-item-card--highlight .catalog-description {
          color: color-mix(in oklab, currentColor 80%, transparent);
        }
        .catalog-item-card-badge {
          position: absolute;
          top: 1rem;
          right: 1rem;
          z-index: 1;
        }
        .catalog-icon {
          font-size: 1.25rem;
        }
        .catalog-title {
          font-size: 1.1rem;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .catalog-description {
          color: var(--muted-foreground);
        }
        .catalog-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: auto;
          gap: 0.75rem;
        }
        .catalog-price {
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-weight: 700;
        }
        .catalog-price:not(.is-paid) {
          color: var(--brand-secondary);
        }
      </style>
    </template>
  };

  static fitted = this.embedded;
}

export class CategoryPillField extends FieldDef {
  static displayName = 'Category Pill';

  @field categoryIcon = contains(StringField);
  @field categoryLabel = contains(StringField);
  @field accentColor = contains(ColorField);
  @field title = contains(StringField, {
    computeVia: function (this: CategoryPillField) {
      return this.categoryLabel;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{#if @model.categoryLabel}}
        <Tag
          @icon={{@model.categoryIcon}}
          @label={{@model.categoryLabel}}
          @accentColor={{@model.accentColor}}
        />
      {{/if}}
    </template>
  };

  static fitted = this.embedded;
}

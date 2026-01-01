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

import { CardContainer, Pill } from '@cardstack/boxel-ui/components';
import { cn, cssVar } from '@cardstack/boxel-ui/helpers';

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
  @field accentColor = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    private get isPaid() {
      let price = this.args.model?.itemPrice;
      if (!price) return false;

      return price.toLowerCase() !== 'free';
    }

    <template>
      <CardContainer
        class={{cn
          'catalog-item-card'
          (if @model.isHighlighted 'catalog-item-card--highlight')
        }}
        style={{cssVar accent-color=@model.accentColor}}
      >
        <div class='catalog-item-header'>
          {{#if @model.badge}}
            <Pill class='catalog-badge'>{{@model.badge}}</Pill>
          {{/if}}
          {{#if @model.itemIcon}}
            <span aria-hidden='true' class='catalog-icon'>
              {{@model.itemIcon}}
            </span>
          {{/if}}
        </div>

        <div class='catalog-item-body'>
          <h4 class='catalog-title'>{{@model.itemTitle}}</h4>
          <p class='catalog-description'>{{@model.itemDescription}}</p>
        </div>

        <div class='catalog-meta'>
          {{#if @model.remixCount.length}}
            <span class='catalog-tag'>{{@model.remixCount}}</span>
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
          gap: 0.75rem;
          padding: 1.5rem;
          background: var(--card);
          color: var(--card-foreground);
          transition:
            transform 0.25s ease,
            box-shadow 0.25s ease,
            border-color 0.25s ease;
        }
        .catalog-item-card:hover {
          transform: translateY(-6px) scale(1.01);
          border-color: var(--cardstack-purple);
          box-shadow:
            0 16px 32px -16px rgba(0, 0, 0, 0.24),
            0 12px 28px -20px rgba(102, 56, 255, 0.3);
        }
        .catalog-item-card--highlight {
          background: var(--accent-color, var(--cardstack-lime));
          border-color: var(--accent-color, var(--cardstack-lime));
          color: var(--boxel-slate);
          box-shadow:
            0 24px 48px -24px rgba(0, 0, 0, 0.35),
            0 0 0 1px rgba(0, 0, 0, 0.05);
        }
        .catalog-item-card--highlight .catalog-description {
          color: rgba(39, 35, 48, 0.8);
        }
        .catalog-item-card--highlight .catalog-badge {
          background: var(--boxel-slate);
          color: var(--accent-color, var(--cardstack-lime));
        }
        .catalog-item-card--highlight .catalog-price {
          color: var(--boxel-slate);
        }
        .catalog-item-card--highlight .catalog-tag {
          background: rgba(39, 35, 48, 0.15);
          color: var(--boxel-slate);
        }
        .catalog-item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xxs);
          min-height: 1.25rem;
        }
        .catalog-badge {
          margin-left: auto;
          background: var(--boxel-slate);
          color: var(--boxel-highlight);
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: 0.65rem;
          letter-spacing: 0.05em;
          padding: 0.35rem 0.75rem;
          border-radius: var(--boxel-border-radius-xs);
          text-transform: uppercase;
        }
        .catalog-icon {
          font-size: 1.25rem;
        }
        .catalog-item-body {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .catalog-title {
          margin: 0;
          font-size: 1.1rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: inherit;
        }
        .catalog-description {
          margin: 0;
          font-size: 0.95rem;
          color: var(--muted-foreground);
          line-height: 1.6;
        }
        .catalog-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: auto;
          gap: 0.75rem;
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

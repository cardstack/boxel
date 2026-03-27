import {
  CardDef,
  Component,
  field,
  contains
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import type BrandGuide from 'https://cardstack.com/base/brand-guide';
import { formatCurrency } from '@cardstack/boxel-ui/helpers';

export class IkeaProduct extends CardDef {
  static displayName = 'Product';

  @field productName = contains(StringField);
  @field heroImage = contains(StringField);
  @field price = contains(NumberField);
  @field currency = contains(StringField);
  @field cardDescription = contains(MarkdownField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: IkeaProduct) {
      return this.cardInfo?.name ?? this.productName ?? 'New Product';
    },
  });

  @field cardThumbnailURL = contains(StringField, {
    computeVia: function (this: IkeaProduct) {
      return this.cardInfo?.cardThumbnailURL ?? this.heroImage ?? null;
    },
  });

  static isolated = class Isolated extends Component<typeof IkeaProduct> { // ¹ isolated format
    get currencyCode() {
      return this.args?.model?.currency ?? 'USD';
    }

    get logo() {
      return (this.args.model.cardInfo?.theme as BrandGuide)?.markUsage?.primaryMark1;
    }

    <template>
      <div class='product-container'>
        <article class='product-sheet'>
          <div class='hero-panel'>
            {{#if @model.heroImage}}
              <img
                src={{@model.heroImage}}
                alt={{@model.productName}}
                class='hero-image'
              />
            {{else}}
              <div class='image-placeholder'>
                <span>Awaiting imagery</span>
              </div>
            {{/if}}
          </div>
          <section class='details-panel'>
            <header>
              {{#if this.logo}}
                <img
                  src={{this.logo}}
                  alt='IKEA'
                  class='brand-logo'
                />
              {{/if}}
              <p class='eyebrow'>IKEA COLLECTION</p>
              <h1><@fields.cardTitle /></h1>
              <p class='price-tag'>
                {{formatCurrency @model.price currency=this.currencyCode}}
              </p>
            </header>
            <div class='description-block'>
              {{#if @model.cardDescription}}
                <@fields.cardDescription />
              {{else}}
                <p class='placeholder'>
                  Design notes coming soon. Add material, finishes, and care
                  instructions to help shoppers choose confidently.
                </p>
              {{/if}}
            </div>
          </section>
        </article>
      </div>
      <style scoped>
        .product-container {
          container-type: inline-size;
          container-name: product-container;
        }

        .product-sheet {
          display: grid;
          grid-template-columns: minmax(18rem, 1.1fr) minmax(16rem, 0.9fr);
          gap: var(--boxel-sp-lg);
          background-color: var(--card);
          color: var(--card-foreground);
          padding: var(--boxel-sp-2xl);
        }

        @container product-container (inline-size <= 880px) {
          .product-sheet {
            grid-template-columns: 1fr;
          }
        }

        .hero-panel {
          background-color: var(--background);
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .hero-image {
          max-width: 100%;
          height: auto;
          border-radius: calc(var(--boxel-border-radius-lg) - 0.25rem);
        }

        .image-placeholder {
          width: 100%;
          aspect-ratio: 4 / 3;
          border-radius: calc(var(--boxel-border-radius-lg) - 0.25rem);
          border: 2px dashed var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .details-panel {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }

        header {
          border-bottom: 1px solid var(--border);
          padding-bottom: var(--boxel-sp);
        }

        .brand-logo {
          display: block;
          height: 2.5rem;
          width: auto;
          margin-bottom: var(--boxel-sp-xs);
        }

        .eyebrow {
          color: var(--primary);
          font-weight: 600;
          letter-spacing: 0.2em;
          font-size: var(--boxel-font-size-xs);
          margin-bottom: var(--boxel-sp-xs);
          text-transform: uppercase;
        }

        h1 {
          font-size: var(--boxel-section-heading-font-size);
          font-weight: var(--boxel-section-heading-font-weight);
          margin: 0 0 var(--boxel-sp-xs);
          line-height: var(--boxel-section-heading-line-height);
        }

        .price-tag {
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
          color: var(--chart-4);
        }

        .description-block :is(p, ul, ol) {
          font-size: var(--boxel-body-font-size);
          line-height: var(--boxel-body-line-height);
          margin-bottom: var(--boxel-sp-sm);
        }

        .placeholder {
          color: var(--muted-foreground);
          font-style: italic;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof IkeaProduct> {
    get currencyCode() {
      return this.args?.model?.currency ?? 'USD';
    }

    get logo() {
      return (this.args.model.cardInfo?.theme as BrandGuide)?.markUsage?.primaryMark1;
    }

    <template>
      <section class='embedded-card'>
        <div class='embedded-visual'>
          {{#if @model.heroImage}}
            <img src={{@model.heroImage}} alt={{@model.productName}} />
          {{else}}
            <div class='tiny-placeholder'>IMG</div>
          {{/if}}
        </div>
        <div class='embedded-content'>
          <div class='name-row'>
            <h3 class='name'><@fields.cardTitle /></h3>
            {{#if this.logo}}
              <img
                src={{this.logo}}
                alt='IKEA'
                class='brand-logo'
              />
            {{/if}}
          </div>
          <p class='price'>
            {{formatCurrency @model.price currency=this.currencyCode}}
          </p>
        </div>
      </section>
      <style scoped>
        .embedded-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: var(--boxel-sp-xs);
          align-items: center;
          padding: var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius);
          background-color: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
        }

        .embedded-visual {
          width: 4rem;
          height: 4rem;
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          background-color: var(--muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .embedded-visual img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .tiny-placeholder {
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.15em;
          color: var(--muted-foreground);
        }

        .name-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
          margin-bottom: var(--boxel-sp-6xs);
        }

        .name {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .brand-logo {
          display: block;
          height: 1.25rem;
          width: auto;
          flex-shrink: 0;
        }

        .price {
          color: var(--primary);
          font-weight: 700;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof IkeaProduct> {
    get currencyCode() {
      return this.args?.model?.currency ?? 'USD';
    }

    <template>
      <article class='fitted-card'>
        <div class='image-wrap'>
          {{#if @model.heroImage}}
            <img src={{@model.heroImage}} alt={{@model.productName}} />
          {{else}}
            <div class='fitted-placeholder'>Awaiting photo</div>
          {{/if}}
        </div>
        <div class='text-block'>
          <p class='title boxel-ellipsize'><@fields.cardTitle /></p>
          <p class='price'>
            {{formatCurrency @model.price currency=this.currencyCode}}
          </p>
        </div>
      </article>
      <style scoped>
        .fitted-card {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: var(--boxel-sp-xs);
          background-color: var(--card);
          color: var(--card-foreground);
        }

        .image-wrap {
          flex: 1;
          border-radius: var(--boxel-border-radius);
          background-color: var(--muted);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 0;
        }

        .image-wrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .fitted-placeholder {
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.2em;
          color: var(--muted-foreground);
          text-transform: uppercase;
        }

        .text-block {
          margin-top: var(--boxel-sp-xs);
          overflow: hidden;
        }

        .title {
          font-weight: 600;
          margin: 0;
          font-size: var(--boxel-font-size-sm);
        }

        .price {
          margin: var(--boxel-sp-6xs) 0 0;
          font-weight: 700;
          font-size: var(--boxel-font-size);
          color: var(--primary);
        }
      </style>
    </template>
  };
}

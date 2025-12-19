import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { formatCurrency } from '@cardstack/boxel-ui/helpers';

export class IkeaProduct extends CardDef {
  static displayName = 'Product';

  @field productName = contains(StringField);
  @field heroImage = contains(StringField);
  @field price = contains(NumberField);
  @field currency = contains(StringField);
  @field description = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: IkeaProduct) {
      return this.cardInfo?.title ?? this.productName ?? 'New Product';
    },
  });

  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: IkeaProduct) {
      return this.cardInfo?.thumbnailURL ?? this.heroImage ?? null;
    },
  });

  static isolated = class Isolated extends Component<typeof IkeaProduct> {
    get currencyCode() {
      return this.args?.model?.currency ?? 'USD';
    }

    <template>
      <article class='product-sheet'>
        <div class='hero-panel'>
          {{#if @model.heroImage}}
            <img
              src={{@model.heroImage}}
              alt={{@model.title}}
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
            <p class='eyebrow'>IKEA COLLECTION</p>
            <h1>{{if @model.title @model.title 'New product'}}</h1>
            <p class='price-tag'>
              {{formatCurrency @model.price currency=this.currencyCode}}
            </p>
          </header>
          <div class='description-block'>
            {{#if @model.description}}
              <@fields.description />
            {{else}}
              <p class='placeholder'>
                Design notes coming soon. Add material, finishes, and care instructions to help shoppers choose confidently.
              </p>
            {{/if}}
          </div>
        </section>
      </article>
      <style scoped>
        .product-sheet { /* ¹⁷ IKEA-inspired split layout */
          display: grid;
          grid-template-columns: minmax(18rem, 1.1fr) minmax(16rem, 0.9fr);
          gap: var(--boxel-sp-lg);
          background: var(--card, #fffaf4);
          color: var(--card-foreground, #1c1c1c);
          padding: clamp(var(--boxel-sp), 3vw, var(--boxel-sp-2xl));
          border-radius: var(--boxel-border-radius-lg, 1rem);
          box-shadow: var(--boxel-box-shadow, 0 12px 45px rgba(0, 0, 0, 0.08));
        }

        @media (max-width: 960px) {
          .product-sheet {
            grid-template-columns: 1fr;
          }
        }

        .hero-panel {
          background: var(--background, #f6f7f9);
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
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.6);
        }

        .image-placeholder {
          width: 100%;
          aspect-ratio: 4/3;
          border-radius: calc(var(--boxel-border-radius-lg) - 0.25rem);
          border: 2px dashed var(--border, #ddd);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--muted-foreground, #7a7a7a);
          font-size: 0.95rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .details-panel {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }

        header {
          border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
          padding-bottom: var(--boxel-sp);
        }

        .eyebrow {
          color: #0058a3;
          font-weight: 600;
          letter-spacing: 0.2em;
          font-size: 0.75rem;
          margin-bottom: 0.25rem;
        }

        h1 {
          font-size: clamp(1.6rem, 3vw, 2.4rem);
          margin: 0 0 0.5rem;
          line-height: 1.2;
        }

        .price-tag {
          font-size: clamp(1.35rem, 2vw, 1.8rem);
          font-weight: 700;
          color: #f8d12f;
          text-shadow: 0 2px 14px rgba(248, 209, 47, 0.3);
        }

        .description-block :is(p, ul, ol) {
          font-size: 0.95rem;
          line-height: 1.55;
          margin-bottom: 0.75rem;
        }

        .placeholder {
          color: var(--muted-foreground, #6f7072);
          font-style: italic;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof IkeaProduct> {
    get currencyCode() {
      return this.args?.model?.currency ?? 'USD';
    }

    <template>
      <section class='embedded-card'>
        <div class='embedded-visual'>
          {{#if @model.heroImage}}
            <img src={{@model.heroImage}} alt={{@model.title}} />
          {{else}}
            <div class='tiny-placeholder'>IMG</div>
          {{/if}}
        </div>
        <div class='embedded-content'>
          <p class='name'>{{if @model.title @model.title 'New product'}}</p>
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
          background: var(--card, #ffffff);
          border: 1px solid var(--border, rgba(0, 0, 0, 0.06));
        }

        .embedded-visual {
          width: 64px;
          height: 64px;
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          background: var(--muted, #f3f4f6);
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
          font-size: 0.65rem;
          letter-spacing: 0.15em;
          color: var(--muted-foreground, #7f828b);
        }

        .name {
          font-weight: 600;
          margin: 0;
          color: var(--card-foreground, #1d1d1f);
        }

        .price {
          margin: 0.15rem 0 0;
          color: #0058a3;
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
            <img src={{@model.heroImage}} alt={{@model.title}} />
          {{else}}
            <div class='fitted-placeholder'>Awaiting photo</div>
          {{/if}}
        </div>
        <div class='text-block'>
          <p class='title'>{{if @model.title @model.title 'New product'}}</p>
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
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius-lg);
          background: linear-gradient(180deg, #ffffff 0%, #f8f9fb 100%);
          border: 1px solid rgba(0, 0, 0, 0.05);
          box-shadow: 0 12px 30px rgba(26, 30, 34, 0.08);
        }

        .image-wrap {
          flex: 1;
          border-radius: var(--boxel-border-radius-lg);
          background: var(--muted, #eef1f5);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .image-wrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .fitted-placeholder {
          font-size: 0.8rem;
          letter-spacing: 0.2em;
          color: var(--muted-foreground, #7c7f87);
          text-transform: uppercase;
        }

        .text-block {
          margin-top: var(--boxel-sp);
        }

        .title {
          font-weight: 600;
          margin: 0;
          font-size: 1rem;
          color: var(--card-foreground, #1d1d1f);
        }

        .price {
          margin: 0.25rem 0 0;
          font-weight: 700;
          font-size: 1.125rem;
          color: #0058a3;
        }
      </style>
    </template>
  };
}

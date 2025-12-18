import {
  CardDef,
  Component,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { IkeaProduct } from './ikea-product';

export class ProductCatalog extends CardDef {
  static displayName = 'Product Catalog';

  @field products = linksToMany(IkeaProduct, {
    query: {
      filter: {
        type: {
          module: new URL('./ikea-product', import.meta.url).href,
          name: 'IkeaProduct',
        },
      },
      sort: [
        {
          on: {
            module: new URL('./ikea-product', import.meta.url).href,
            name: 'IkeaProduct',
          },
          by: 'productName',
          direction: 'asc',
        },
      ],
    },
  });

  static isolated = class Isolated extends Component<typeof ProductCatalog> {
    <template>
      <section class='catalog'>
        <header class='catalog__header'>
          <p class='eyebrow'>SCANDI LIVING</p>
          <h1>Furniture Collection</h1>
          <p class='subhead'>
            Browse modular sofas, storage, and lighting selected for a bright,
            Ikea-inspired home.
          </p>
        </header>

        {{#if @model.products.length}}
          <div class='catalog__grid'>
            {{#each @fields.products as |product|}}
              <div class='catalog__item'>
                <product @format='fitted' />
              </div>
            {{/each}}
          </div>
        {{else}}
          <div class='catalog__empty'>
            <p>No products yet. Add IkeaProduct cards to automatically populate
              this grid.</p>
          </div>
        {{/if}}
      </section>
      <style scoped>
        .catalog {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: clamp(var(--boxel-sp), 4vw, var(--boxel-sp-3xl));
          background: var(--background, #f6f7f9);
          border-radius: var(--boxel-border-radius-xl, 1.5rem);
          box-shadow: var(--boxel-box-shadow, 0 18px 55px rgba(0, 0, 0, 0.08));
        }

        .catalog__header {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          color: var(--foreground, #0f1115);
        }

        .eyebrow {
          color: #0058a3;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.35em;
          margin: 0;
        }

        h1 {
          margin: 0;
          font-size: clamp(1.9rem, 3vw, 2.6rem);
          line-height: 1.2;
        }

        .subhead {
          margin: 0;
          color: var(--muted-foreground, #4c4f56);
          max-width: 42rem;
        }

        .catalog__grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: var(--boxel-sp-lg);
          grid-auto-rows: minmax(220px, 1fr);
        }

        .catalog__item {
          aspect-ratio: 1 / 1;
          display: flex;
          border: none;
          background: transparent;
        }

        .catalog__item > * {
          width: 100%;
          height: 100%;
          display: flex;
        }

        .catalog__empty {
          border: 1px dashed var(--border, rgba(0, 0, 0, 0.2));
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp-lg);
          text-align: center;
          color: var(--muted-foreground, #6b6e73);
        }
      </style>
    </template>
  };

  static embedded = this.isolated;

  static fitted = class Fitted extends Component<typeof ProductCatalog> {
    <template>
      <div class='catalog-fitted'>
        <p class='catalog-fitted__title'>Furniture Catalog</p>
        <p class='catalog-fitted__count'>
          {{@model.products.length}}
          products
        </p>
      </div>
      <style scoped>
        .catalog-fitted {
          width: 100%;
          height: 100%;
          display: grid;
          place-content: center;
          text-align: center;
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius-lg);
          background: linear-gradient(180deg, #ffffff 0%, #f0f4fb 100%);
          color: var(--card-foreground, #101115);
          border: 1px solid rgba(0, 0, 0, 0.05);
        }

        .catalog-fitted__title {
          margin: 0;
          font-size: 1.1rem;
          font-weight: 600;
        }

        .catalog-fitted__count {
          margin: 0.35rem 0 0;
          font-size: 0.9rem;
          color: var(--muted-foreground, #686b72);
        }
      </style>
    </template>
  };
}

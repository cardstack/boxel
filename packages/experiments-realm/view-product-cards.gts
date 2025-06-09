import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

import {
  Component,
  CardDef,
  realmURL,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

// Product Card Definition
export class Product extends CardDef {
  static displayName = 'Product';
  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field price = contains(StringField);
  @field imageUrl = contains(StringField);

  // Atom template for compact view
  static atom = class extends Component<typeof Product> {
    <template>
      <div class='product-atom'>
        <img
          src={{@model.imageUrl}}
          alt={{@model.title}}
          class='product-atom-image'
        />
        <div class='product-atom-info'>
          <h4>{{@model.title}}</h4>
          <p class='price'>{{@model.price}}</p>
        </div>
      </div>

      <style scoped>
        .product-atom {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.5rem;
          border-radius: 4px;
          background: #f5f5f5;
        }

        .product-atom-image {
          width: 50px;
          height: 50px;
          object-fit: cover;
          border-radius: 4px;
        }

        .product-atom-info {
          flex: 1;
        }

        .product-atom-info h4 {
          margin: 0;
          font-size: 0.9rem;
        }

        .price {
          margin: 0;
          color: #666;
          font-size: 0.8rem;
        }
      </style>
    </template>
  };

  // Embedded template for nested view
  static embedded = class extends Component<typeof Product> {
    <template>
      <div class='product-embedded'>
        <div class='product-embedded-header'>
          <h3>{{@model.title}}</h3>
          <span class='price'>{{@model.price}}</span>
        </div>
        <div class='product-embedded-content'>
          <img
            src={{@model.imageUrl}}
            alt={{@model.title}}
            class='product-embedded-image'
          />
          <div class='description'>{{@model.description}}</div>
        </div>
      </div>

      <style scoped>
        .product-embedded {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 1rem;
          background: white;
        }

        .product-embedded-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .product-embedded-header h3 {
          margin: 0;
          font-size: 1.1rem;
        }

        .price {
          font-weight: bold;
          color: #2c5282;
        }

        .product-embedded-content {
          display: flex;
          gap: 1rem;
        }

        .product-embedded-image {
          width: 150px;
          height: 150px;
          object-fit: cover;
          border-radius: 4px;
        }

        .description {
          flex: 1;
          font-size: 0.9rem;
          color: #4a5568;
        }
      </style>
    </template>
  };
}

// Store Component with viewCard implementations
class StoreIsolatedTemplate extends Component<typeof Store> {
  // View a specific product in isolated format
  @action
  viewProduct(product: Product) {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }

    // View product in isolated format (default)
    this.args.context.actions.viewCard(product);
  }

  // View product in compact format (for lists)
  @action
  viewProductCompact(product: Product) {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }

    // View product in atom format
    this.args.context.actions.viewCard(product, 'atom');
  }

  // View product in embedded format
  @action
  viewProductEmbedded(product: Product) {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }

    // View product in embedded format
    this.args.context.actions.viewCard(product, 'embedded');
  }

  // View product by URL
  @action
  viewProductByURL(productId: string) {
    if (!this.args.context?.actions?.viewCard) {
      throw new Error('viewCard action is not available');
    }

    let baseUrl = this.args.model[realmURL];
    if (!baseUrl) {
      throw new Error('No realm URL available');
    }

    // Construct URL to product JSON file
    let productUrl = new URL(`${productId}.json`, baseUrl);
    this.args.context.actions.viewCard(productUrl);
  }

  <template>
    <div class='store-container'>
      <h1>{{@model.name}}</h1>

      <!-- Product Grid -->
      <div class='products-grid'>
        {{#each @model.products as |product|}}
          <div class='product-card'>
            <img src={{product.imageUrl}} alt={{product.title}} />
            <h3>{{product.title}}</h3>
            <p>{{product.price}}</p>

            <!-- Action Buttons -->
            <div class='product-actions'>
              <BoxelButton
                @kind='primary'
                {{on 'click' (fn this.viewProduct product)}}
              >
                View Details
              </BoxelButton>

              <BoxelButton
                @kind='secondary'
                {{on 'click' (fn this.viewProductCompact product)}}
              >
                Quick View
              </BoxelButton>
            </div>
          </div>
        {{/each}}
      </div>
    </div>

    <style scoped>
      .store-container {
        padding: 2rem;
      }

      .products-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 2rem;
        margin-top: 2rem;
      }

      .product-card {
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 1rem;
        background: white;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .product-card img {
        width: 100%;
        height: 200px;
        object-fit: cover;
        border-radius: 4px;
      }

      .product-actions {
        display: flex;
        gap: 1rem;
        margin-top: 1rem;
      }
    </style>
  </template>
}

// Store Card Definition
export class Store extends CardDef {
  static displayName = 'My Store';
  @field name = contains(StringField);
  @field products = linksToMany(Product);
  @field title = contains(StringField, {
    computeVia(this: Store) {
      return this.name;
    },
  });

  static isolated = StoreIsolatedTemplate;
}

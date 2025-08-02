import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import UrlField from 'https://cardstack.com/base/url';
import { currencyFormat } from '@cardstack/boxel-ui/helpers';
import HomeIcon from '@cardstack/boxel-icons/home';

class IsolatedFurnitureTearSheetTemplate extends Component<
  typeof FurnitureTearSheet
> {
  <template>
    <div class='stage'>
      <div class='tear-sheet-mat'>
        <header class='tear-sheet-header'>
          <div class='header-content'>
            <h1 class='product-title'>{{if
                @model.productName
                @model.productName
                'Product Name'
              }}</h1>
            {{#if @model.collection}}
              <div class='collection-badge'>{{@model.collection}}
                Collection</div>
            {{/if}}

            <div class='header-meta'>
              {{#if @model.sku}}
                <span class='sku'>SKU: {{@model.sku}}</span>
              {{/if}}
              {{#if @model.price}}
                <span class='price'>{{currencyFormat @model.price 'USD'}}</span>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='content-grid'>
          <section class='hero-section'>
            {{#if @model.heroImageUrl}}
              <img
                src={{@model.heroImageUrl}}
                alt={{@model.productName}}
                class='hero-image'
              />
            {{else}}
              <div class='hero-placeholder'>
                <div class='placeholder-content'>
                  <span class='placeholder-icon' aria-hidden='true'>🪑</span>
                  <p>Product Photography</p>
                  <p class='placeholder-hint'>Add hero image URL to display
                    product photo</p>
                </div>
              </div>
            {{/if}}
          </section>

          <section class='details-section'>
            <div class='detail-group'>
              <h2>Product Details</h2>

              {{#if @model.description}}
                <div class='description'>
                  <@fields.description />
                </div>
              {{else}}
                <p class='placeholder-text'>Add product description to highlight
                  key features and benefits.</p>
              {{/if}}

              <div class='specs-grid'>
                {{#if @model.dimensions}}
                  <div class='spec-item'>
                    <dt>Dimensions</dt>
                    <dd>{{@model.dimensions}}</dd>
                  </div>
                {{/if}}

                {{#if @model.materials}}
                  <div class='spec-item'>
                    <dt>Materials</dt>
                    <dd>{{@model.materials}}</dd>
                  </div>
                {{/if}}

                {{#if @model.finish}}
                  <div class='spec-item'>
                    <dt>Finish</dt>
                    <dd>{{@model.finish}}</dd>
                  </div>
                {{/if}}

                {{#if @model.weight}}
                  <div class='spec-item'>
                    <dt>Weight</dt>
                    <dd>{{@model.weight}}</dd>
                  </div>
                {{/if}}
              </div>
            </div>

            {{#if @model.designerNotes}}
              <div class='detail-group'>
                <h2>Designer Notes</h2>
                <div class='designer-notes'>
                  <@fields.designerNotes />
                </div>
              </div>
            {{/if}}

            {{#if @model.careinstructions}}
              <div class='detail-group'>
                <h2>Care Instructions</h2>
                <div class='care-instructions'>
                  <@fields.careinstructions />
                </div>
              </div>
            {{/if}}
          </section>
        </div>
      </div>
    </div>

    <style scoped>
      .stage {
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        padding: 2rem;
      }

      .tear-sheet-mat {
        max-width: 56rem;
        margin: 0 auto;
        background: white;
        border-radius: 1rem;
        box-shadow:
          0 20px 25px -5px rgba(0, 0, 0, 0.1),
          0 10px 10px -5px rgba(0, 0, 0, 0.04);
        overflow-y: auto;
        max-height: 100%;
      }

      .tear-sheet-header {
        background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
        color: white;
        padding: 2rem;
        border-radius: 1rem 1rem 0 0;
      }

      .product-title {
        font-size: 2.25rem;
        font-weight: 700;
        margin: 0 0 0.75rem 0;
        letter-spacing: -0.025em;
      }

      .collection-badge {
        display: inline-block;
        background: rgba(255, 255, 255, 0.2);
        padding: 0.5rem 1rem;
        border-radius: 2rem;
        font-size: 0.875rem;
        font-weight: 500;
        margin-bottom: 1rem;
      }

      .header-meta {
        display: flex;
        gap: 2rem;
        font-size: 1.125rem;
      }

      .sku {
        opacity: 0.8;
      }

      .price {
        font-weight: 600;
        color: #10b981;
      }

      .content-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3rem;
        padding: 3rem;
      }

      .hero-section {
        position: relative;
      }

      .hero-image {
        width: 100%;
        height: 400px;
        object-fit: cover;
        border-radius: 0.75rem;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
      }

      .hero-placeholder {
        width: 100%;
        height: 400px;
        background: #f9fafb;
        border: 3px dashed #d1d5db;
        border-radius: 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .placeholder-content {
        text-align: center;
        color: #6b7280;
      }

      .placeholder-icon {
        display: block;
        font-size: 4rem;
        margin-bottom: 1rem;
      }

      .placeholder-hint {
        font-size: 0.875rem;
        margin-top: 0.5rem;
        font-style: italic;
      }

      .details-section {
        display: flex;
        flex-direction: column;
        gap: 2rem;
      }

      .detail-group h2 {
        font-size: 1.375rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 1rem 0;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid #e5e7eb;
      }

      .description {
        margin-bottom: 1.5rem;
        line-height: 1.7;
      }

      .placeholder-text {
        color: #9ca3af;
        font-style: italic;
        margin: 1rem 0;
      }

      .specs-grid {
        display: grid;
        gap: 1rem;
      }

      .spec-item {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem;
        background: #f9fafb;
        border-radius: 0.5rem;
        border-left: 4px solid #6366f1;
      }

      .spec-item dt {
        font-weight: 600;
        color: #374151;
      }

      .spec-item dd {
        color: #6b7280;
        text-align: right;
        margin: 0;
      }

      .designer-notes,
      .care-instructions {
        background: #fef3c7;
        padding: 1.5rem;
        border-radius: 0.75rem;
        border-left: 4px solid #f59e0b;
      }

      .care-instructions {
        background: #ecfdf5;
        border-left-color: #10b981;
      }

      @media (max-width: 768px) {
        .content-grid {
          grid-template-columns: 1fr;
          gap: 2rem;
          padding: 2rem;
        }

        .product-title {
          font-size: 1.875rem;
        }

        .header-meta {
          flex-direction: column;
          gap: 0.5rem;
        }
      }
    </style>
  </template>
}

class EmbeddedFurnitureTearSheetTemplate extends Component<
  typeof FurnitureTearSheet
> {
  <template>
    <div class='tear-sheet-preview'>
      {{#if @model.heroImageUrl}}
        <img
          src={{@model.heroImageUrl}}
          alt={{@model.productName}}
          class='preview-image'
        />
      {{else}}
        <div class='image-placeholder' aria-label='Product image placeholder'>
          <span aria-hidden='true'>📐</span>
          <span>Product Image</span>
        </div>
      {{/if}}

      <div class='preview-details'>
        <h3>{{if @model.productName @model.productName 'Unnamed Product'}}</h3>
        {{#if @model.collection}}
          <span class='collection'>{{@model.collection}} Collection</span>
        {{/if}}
        {{#if @model.price}}
          <span class='price'>{{currencyFormat @model.price 'USD'}}</span>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .tear-sheet-preview {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        background: white;
      }

      .preview-image {
        width: 120px;
        height: 90px;
        object-fit: cover;
        border-radius: 0.375rem;
      }

      .image-placeholder {
        width: 120px;
        height: 90px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        border: 2px dashed #d1d5db;
        border-radius: 0.375rem;
        color: #6b7280;
        font-size: 0.9rem;
        gap: 0.25rem;
      }

      .preview-details h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.1rem;
        font-weight: 600;
      }

      .collection {
        display: block;
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 0.5rem;
      }

      .price {
        font-weight: 600;
        color: #059669;
      }
    </style>
  </template>
}

export class FurnitureTearSheet extends CardDef {
  static displayName = 'Furniture Tear Sheet';
  static icon = HomeIcon;
  static prefersWideFormat = true;

  @field productName = contains(StringField);
  @field collection = contains(StringField);
  @field heroImageUrl = contains(UrlField);
  @field description = contains(MarkdownField);
  @field dimensions = contains(StringField);
  @field materials = contains(StringField);
  @field finish = contains(StringField);
  @field weight = contains(StringField);
  @field price = contains(NumberField);
  @field sku = contains(StringField);
  @field designerNotes = contains(MarkdownField);
  @field careinstructions = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: FurnitureTearSheet) {
      const name = this.productName ?? 'Furniture Piece';
      const collection = this.collection ? ` - ${this.collection}` : '';
      return `${name}${collection}`;
    },
  });

  static isolated = IsolatedFurnitureTearSheetTemplate;
  static embedded = EmbeddedFurnitureTearSheetTemplate;
}

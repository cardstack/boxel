import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { ProductRotationImage } from './product-rotation-image';

class ProductCatalogIsolated extends Component<typeof ProductCatalog> {
  get title() {
    return this.args.model?.title ?? 'Product Catalog';
  }

  get description() {
    return this.args.model?.description ?? '';
  }

  get rotationImages() {
    return (this.args.model?.rotationImages ?? []).filter((rotation) =>
      Boolean(rotation?.image?.url),
    );
  }

  imageFor(rotation: ProductRotationImage) {
    return rotation?.image?.url ?? '';
  }

  angleLabel(rotation: ProductRotationImage) {
    return rotation?.angleLabel ?? '';
  }

  <template>
    <article class='catalog'>
      <header class='catalog__header'>
        <h1 class='catalog__title'>{{this.title}}</h1>
        {{#if this.description}}
          <p class='catalog__description'>
            {{this.description}}
          </p>
        {{/if}}
      </header>

      {{#if this.rotationImages.length}}
        <section class='catalog__gallery' aria-label='Product rotation gallery'>
          <ul class='catalog__list'>
            {{#each this.rotationImages as |rotation|}}
              <li class='catalog__card'>
                <figure class='catalog__figure'>
                  <div class='catalog__image-wrap'>
                    <img
                      src={{this.imageFor rotation}}
                      alt={{this.angleLabel rotation}}
                    />
                  </div>
                  <figcaption class='catalog__caption'>
                    {{this.angleLabel rotation}}
                  </figcaption>
                </figure>
              </li>
            {{/each}}
          </ul>
        </section>
      {{else}}
        <div class='catalog__empty'>
          <p>No generated rotation images yet.</p>
        </div>
      {{/if}}
    </article>

    <style scoped>
      .catalog {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        padding: 1rem;
      }

      .catalog__title {
        margin: 0;
        font-size: 1.75rem;
        color: #111827;
      }

      .catalog__description {
        margin: 0.5rem 0 0;
        color: #4b5563;
        font-size: 1rem;
        line-height: 1.6;
      }

      .catalog__gallery {
        background: linear-gradient(
          135deg,
          rgba(15, 23, 42, 0.04),
          transparent
        );
        border-radius: 20px;
        padding: 1.5rem;
        border: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
      }

      .catalog__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 1.5rem;
      }

      .catalog__card {
        display: flex;
        flex-direction: column;
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
        padding: 1rem;
        border: 1px solid rgba(148, 163, 184, 0.25);
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease;
      }

      .catalog__card:hover {
        transform: translateY(-4px);
        box-shadow: 0 20px 50px rgba(30, 64, 175, 0.18);
      }

      .catalog__figure {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin: 0;
      }

      .catalog__image-wrap {
        position: relative;
        width: 100%;
        border-radius: 12px;
        overflow: hidden;
        background:
          radial-gradient(
            circle at top,
            rgba(96, 165, 250, 0.16),
            transparent 60%
          ),
          #f8fafc;
      }

      .catalog__image-wrap::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
      }

      .catalog__image-wrap img {
        width: 100%;
        object-fit: contain;
        display: block;
        padding: 1rem;
        backdrop-filter: blur(2px);
      }

      .catalog__caption {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1f2937;
        text-align: center;
      }

      .catalog__empty {
        padding: 2rem;
        border: 2px dashed #cbd5f5;
        border-radius: 16px;
        display: flex;
        justify-content: center;
        color: #64748b;
        background: rgba(226, 232, 240, 0.25);
      }
    </style>
  </template>
}

export class ProductCatalog extends CardDef {
  static displayName = 'Product Catalog';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field description = contains(StringField);
  @field rotationImages = linksToMany(() => ProductRotationImage);

  static isolated = ProductCatalogIsolated;
}

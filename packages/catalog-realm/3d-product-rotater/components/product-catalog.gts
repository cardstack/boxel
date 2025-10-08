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

  get rotations() {
    return (this.args.model?.rotations ?? []).filter((rotation) =>
      Boolean(rotation?.image?.data?.base64),
    );
  }

  imageFor(rotation: ProductRotationImage) {
    return rotation?.image?.data?.base64 ?? '';
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

      {{#if this.rotations.length}}
        <section class='catalog__grid'>
          {{#each this.rotations as |rotation|}}
            <figure class='catalog__item'>
              <img
                src={{this.imageFor rotation}}
                alt={{this.angleLabel rotation}}
              />
              <figcaption>{{this.angleLabel rotation}}</figcaption>
            </figure>
          {{/each}}
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

      .catalog__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 1.25rem;
      }

      .catalog__item {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
        padding: 1rem;
        border: 1px solid rgba(148, 163, 184, 0.2);
      }

      .catalog__item img {
        width: 100%;
        object-fit: contain;
        border-radius: 8px;
        background: linear-gradient(135deg, #f8fafc, #eef2ff);
      }

      figcaption {
        font-size: 0.9rem;
        font-weight: 600;
        color: #1f2937;
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
  @field rotations = linksToMany(() => ProductRotationImage);

  static isolated = ProductCatalogIsolated;
  static embedded = ProductCatalogIsolated;
  static fitted = ProductCatalogIsolated;
}

import {
  CardDef,
  Component,
  containsMany,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import PhotoIcon from '@cardstack/boxel-icons/photo';
import ImageCarousel from 'https://realms-staging.stack.cards/catalog/catalog-app/components/image-carousel';

export class ImageCarouselDemo extends CardDef {
  static displayName = 'Image Carousel Demo';
  static icon = PhotoIcon;

  @field images = containsMany(StringField);

  static isolated = class Isolated extends Component<typeof ImageCarouselDemo> {
    get items(): string[] {
      return ((this.args.model.images ?? []) as string[]).filter(Boolean);
    }

    <template>
      <article class='demo'>
        <h1>{{@model.cardTitle}}</h1>
        <div class='stage'>
          <ImageCarousel @items={{this.items}}>
            <:icon></:icon>
          </ImageCarousel>
        </div>
        <p class='note'>The catalog Image Carousel over
          {{this.items.length}}
          image URLs — arrows and dots come from the component.</p>
      </article>
      <style scoped>
        .demo {
          max-width: 46rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
        }
        h1 {
          margin: 0 0 1rem;
          font-size: 1.375rem;
        }
        .stage {
          height: 22rem;
          border-radius: 0.75rem;
          overflow: hidden;
          border: 1px solid var(--border, #e5e7eb);
        }
        .stage > :deep(*) {
          height: 100%;
        }
        .note {
          margin: 0.75rem 0 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}

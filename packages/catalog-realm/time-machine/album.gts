import {
  CardDef,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { PolaroidImage } from './polaroid-image';
import {
  LightboxCarousel,
  type LightboxItem,
} from '../components/lightbox-carousel';
import { PolaroidScatter } from './polaroid-scatter';

export class AlbumIsolated extends Component<typeof Album> {
  @tracked isLightboxOpen = false;
  @tracked lightboxIndex = 0;

  get polaroidImages() {
    return this.args.model?.images ?? [];
  }

  get lightboxItems(): LightboxItem[] {
    return this.polaroidImages
      .filter((image) => Boolean(image?.image?.url))
      .map((image) => ({
        card: image,
        component: image.constructor.getComponent(image),
      }));
  }

  @action
  handlePolaroidSelect(image: PolaroidImage) {
    if (!image?.image?.url) {
      return;
    }
    let items = this.lightboxItems;
    let index = items.findIndex((item) => item.card === image);
    if (index === -1) {
      return;
    }
    this.lightboxIndex = index;
    this.isLightboxOpen = true;
  }

  @action
  closeLightbox() {
    this.isLightboxOpen = false;
  }

  @action
  handleLightboxIndexChange(index: number) {
    this.lightboxIndex = index;
  }

  <template>
    <main class='gallery'>
      <PolaroidScatter
        @images={{this.polaroidImages}}
        @onSelect={{this.handlePolaroidSelect}}
      />
      <LightboxCarousel
        @isOpen={{this.isLightboxOpen}}
        @items={{this.lightboxItems}}
        @startIndex={{this.lightboxIndex}}
        @onClose={{this.closeLightbox}}
        @onIndexChange={{this.handleLightboxIndexChange}}
        as |item|
      >
        <item.component @format='isolated' />
      </LightboxCarousel>
    </main>
    <style scoped>
      .gallery {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
    </style>
  </template>
}

export class Album extends CardDef {
  static displayName = 'Album';
  static prefersWideFormat = true;

  @field images = linksToMany(() => PolaroidImage);

  static isolated = AlbumIsolated;
}

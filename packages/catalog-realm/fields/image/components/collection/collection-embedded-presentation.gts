import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import GridPresentation from './grid-presentation';
import CarouselPresentation from './carousel-presentation';
import ImageField from '../../image-field';

type ImageCollectionPresentationType = 'standard' | 'grid' | 'carousel';

interface CollectionEmbeddedPresentationArgs {
  Args: {
    images: ImageField[] | undefined;
    presentation: ImageCollectionPresentationType;
    hasImages: boolean;
  };
}

export default class CollectionEmbeddedPresentation extends GlimmerComponent<CollectionEmbeddedPresentationArgs> {
  <template>
    {{#if @hasImages}}
      <div
        class='image-field-embedded multiple-image-embedded presentation-{{@presentation}}'
      >
        {{#if (eq @presentation 'carousel')}}
          <CarouselPresentation @images={{@images}} />
        {{else}}
          <GridPresentation @images={{@images}} />
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      .image-field-embedded.multiple-image-embedded {
        width: 100%;
      }
    </style>
  </template>
}

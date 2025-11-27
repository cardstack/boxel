import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import ImagePresentation from './image-presentation';
import InlinePresentation from './inline-presentation';
import CardPresentation from './card-presentation';

type ImagePresentationType = 'standard' | 'image' | 'inline' | 'card';

interface SingleEmbeddedPresentationArgs {
  Args: {
    imageUrl?: string;
    presentation: ImagePresentationType;
    hasImage: boolean;
  };
}

export default class SingleEmbeddedPresentation extends GlimmerComponent<SingleEmbeddedPresentationArgs> {
  <template>
    {{#if (eq @presentation 'inline')}}
      <InlinePresentation
        @imageUrl={{@imageUrl}}
        @hasImage={{@hasImage}}
      />
    {{else if (eq @presentation 'card')}}
      <CardPresentation
        @imageUrl={{@imageUrl}}
        @hasImage={{@hasImage}}
      />
    {{else}}
      <ImagePresentation
        @imageUrl={{@imageUrl}}
        @hasImage={{@hasImage}}
      />
    {{/if}}
  </template>
}


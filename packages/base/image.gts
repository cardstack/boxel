import { CardDef, Component, contains, field } from './card-api';
import UrlField from './url';

class ImageCardView extends Component<typeof ImageCard> {
  <template>
    {{#if @model.url}}
      <img
        class='image-card__media'
        src={{@model.url}}
        alt=''
        loading='lazy'
      />
    {{else}}
      <div class='image-card__placeholder'>No image URL provided</div>
    {{/if}}
    <style scoped>
      .image-card__media {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: var(--boxel-form-control-border-radius, 4px);
      }
      .image-card__placeholder {
        padding: var(--boxel-sp, 12px);
        text-align: center;
        color: var(--boxel-500, #666);
        background-color: var(--boxel-50, #f5f5f5);
        border-radius: var(--boxel-form-control-border-radius, 4px);
      }
    </style>
  </template>
}

export class ImageCard extends CardDef {
  static displayName = 'Image';

  @field url = contains(UrlField);

  static isolated = ImageCardView;
  static embedded = ImageCardView;
  static atom = class extends Component<typeof ImageCard> {
    <template>
      <@fields.url @format='atom' />
    </template>
  };
}

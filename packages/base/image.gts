import { CardDef, Component, contains, field } from './card-api';
import UrlField from './url';

class ImageCardView extends Component<typeof ImageCard> {
  <template>
    {{#if @model.url}}
      <img class='image' src={{@model.url}} alt='' loading='lazy' />
    {{else}}
      <div class='empty-placeholder'>No image URL provided</div>
    {{/if}}
    <style scoped>
      .image {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: var(--boxel-form-control-border-radius);
      }
      .empty-placeholder {
        padding: var(--boxel-sp);
        text-align: center;
        color: var(--boxel-500);
        background-color: var(--boxel-150);
        border-radius: var(--boxel-form-control-border-radius);
      }
    </style>
  </template>
}

export default class ImageCard extends CardDef {
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

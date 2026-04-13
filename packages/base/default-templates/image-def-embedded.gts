import GlimmerComponent from '@glimmer/component';
import type { ImageDef } from '../card-api';

export default class ImageDefEmbeddedTemplate extends GlimmerComponent<{
  Args: {
    model: ImageDef;
  };
}> {
  <template>
    <div class='image-embedded'>
      {{#if @model.url}}
        <img class='image-embedded__img' src={{@model.url}} alt={{@model.name}} />
      {{else}}
        <p class='image-embedded__empty'>{{@model.name}}</p>
      {{/if}}
    </div>
    <style scoped>
      .image-embedded {
        width: 100%;
      }

      .image-embedded__img {
        display: block;
        width: 100%;
        height: auto;
        border-radius: var(--boxel-radius-sm);
      }

      .image-embedded__empty {
        color: var(--boxel-600);
        margin: 0;
      }
    </style>
  </template>
}

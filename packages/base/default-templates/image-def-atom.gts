import GlimmerComponent from '@glimmer/component';
import type { ImageDef } from '../card-api';

export default class ImageDefAtomTemplate extends GlimmerComponent<{
  Args: {
    model: ImageDef;
  };
}> {
  <template>
    <div class='image-atom'>
      {{#if @model.url}}
        <img class='image-atom__img' src={{@model.url}} alt={{@model.name}} />
      {{/if}}
      <span class='image-atom__name'>{{@model.name}}</span>
    </div>
    <style scoped>
      .image-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }

      .image-atom__img {
        width: 20px;
        height: 20px;
        object-fit: cover;
        border-radius: var(--boxel-radius-xs);
        flex-shrink: 0;
      }

      .image-atom__name {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

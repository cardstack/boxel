import GlimmerComponent from '@glimmer/component';
import type { ImageDef } from '../card-api';

export default class ImageDefIsolatedTemplate extends GlimmerComponent<{
  Args: {
    model: ImageDef;
  };
}> {
  <template>
    <div class='image-isolated'>
      {{#if @model.url}}
        <img
          class='image-isolated__img'
          src={{@model.url}}
          alt={{@model.name}}
          width={{@model.width}}
          height={{@model.height}}
        />
        <footer class='image-isolated__meta'>
          <span class='image-isolated__name'>{{@model.name}}</span>
          {{#if @model.width}}
            <span class='image-isolated__dimensions'>{{@model.width}}
              &times;
              {{@model.height}}px</span>
          {{/if}}
        </footer>
      {{else}}
        <p class='image-isolated__empty'>{{@model.name}}</p>
      {{/if}}
    </div>
    <style scoped>
      .image-isolated {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-xs);
        max-width: 100%;
      }

      .image-isolated__img {
        max-width: 100%;
        height: auto;
        border-radius: var(--boxel-radius-sm);
      }

      .image-isolated__meta {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
        padding-bottom: var(--boxel-sp-xs);
      }

      .image-isolated__name {
        font-weight: 600;
        color: var(--boxel-900);
      }

      .image-isolated__empty {
        color: var(--boxel-600);
        margin: 0;
      }
    </style>
  </template>
}

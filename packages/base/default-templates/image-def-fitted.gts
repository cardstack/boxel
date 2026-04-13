import GlimmerComponent from '@glimmer/component';

import setBackgroundImage from '../helpers/set-background-image';
import type { ImageDef } from '../card-api';

export default class ImageDefFittedTemplate extends GlimmerComponent<{
  Args: {
    model: ImageDef;
  };
}> {
  <template>
    <div class='image-fitted'>
      {{#if @model.url}}
        <div
          class='image-fitted__bg'
          style={{setBackgroundImage @model.url}}
          role='img'
          aria-label={{@model.name}}
        ></div>
      {{else}}
        <div class='image-fitted__placeholder'>
          <span class='image-fitted__name'>{{@model.name}}</span>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .image-fitted {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      .image-fitted__bg {
        width: 100%;
        height: 100%;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      }

      .image-fitted__placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--boxel-100);
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
      }

      .image-fitted__name {
        font-size: var(--boxel-font-xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
      }
    </style>
  </template>
}

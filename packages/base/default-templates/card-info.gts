import GlimmerComponent from '@glimmer/component';

import type { CardOrFieldTypeIcon } from '../card-api';

import setBackgroundImage from '../helpers/set-background-image';

export default class CardInfo extends GlimmerComponent<{
  Args: {
    title?: string;
    description?: string;
    thumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
  };
  Blocks: { default: [] };
}> {
  <template>
    {{#if @thumbnailURL}}
      <div
        class='image-container thumbnail'
        style={{setBackgroundImage @thumbnailURL}}
        role='presentation'
        data-test-field='thumbnailURL'
      />
    {{else if @icon}}
      <div class='image-container'>
        <@icon class='icon' width='50' height='40' data-test-thumbnail-icon />
      </div>
    {{/if}}
    <div class='info'>
      <h2 class='card-info-title' data-test-field='title'>{{@title}}</h2>
      <p class='card-info-description' data-test-field='description'>
        {{@description}}
      </p>
    </div>
    <style scoped>
      @layer {
        .image-container {
          --thumbnail-container-size: 6.25rem;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          width: var(--thumbnail-container-size);
          height: var(--thumbnail-container-size);
          min-width: var(--thumbnail-container-size);
          min-height: var(--thumbnail-container-size);
          border-radius: var(--radius, var(--boxel-border-radius-xl));
          background-color: var(--background, var(--boxel-light));
        }
        .thumbnail {
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
        }
        .card-info-title {
          margin-block: 0;
          font-size: var(--boxel-font-size);
          font-weight: 600;
          letter-spacing: var(--boxel-lsp-sm);
          line-height: calc(22 / 16);
        }
        .card-info-description {
          margin-block: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 400;
          letter-spacing: var(--boxel-lsp-sm);
          line-height: calc(18 / 13);
        }
        .info > * + * {
          margin-top: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

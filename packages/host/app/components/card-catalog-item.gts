import Component from '@glimmer/component';
import { cssURL } from '@cardstack/boxel-ui/helpers/css-url';
import type { CardContext } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    title: string;
    description?: string;
    thumbnailURL?: string;
    context?: CardContext;
  };
}

export default class CardCatalogItem extends Component<Signature> {
  <template>
    <div class='catalog-item'>
      <div
        class='catalog-item__thumbnail'
        style={{if @thumbnailURL (cssURL 'background-image' @thumbnailURL)}}
      />
      <div>
        <header class='catalog-item__title'>
          {{@title}}
        </header>
        {{#if @description}}
          <p class='catalog-item__description' data-test-description>
            {{@description}}
          </p>
        {{/if}}
      </div>
    </div>

    <style>
      .catalog-item {
        --catalog-item-thumbnail-size: 2.5rem;
        display: grid;
        grid-template-columns: var(--catalog-item-thumbnail-size) 1fr;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-xs);
      }
      .catalog-item__thumbnail {
        width: var(--catalog-item-thumbnail-size);
        height: var(--catalog-item-thumbnail-size);
        border-radius: 100px;
        background-size: contain;
        background-position: center;
      }
      .catalog-item__title {
        font: 700 var(--boxel-font-sm);
        color: var(--boxel-dark);
      }
      .catalog-item__description {
        margin: 0;
        font: var(--boxel-font-xs);
        color: var(--boxel-500);
      }

    </style>
  </template>
}

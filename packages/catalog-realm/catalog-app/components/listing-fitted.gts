import Component from '@glimmer/component';
// @ts-ignore
import type { ComponentLike } from '@glint/template';
// @ts-ignore
import cssUrl from 'ember-css-url';

// Default to show the first imageURL; if there is no imageURL, show iconComponent.
interface Signature {
  Args: {
    iconComponent?: ComponentLike<{
      Element: Element;
    }>;
    isEmpty?: boolean;
    primary?: string;
    secondary?: string;
    imageURL?: string;
  };
  Element: HTMLDivElement;
}

export default class ListingFitted extends Component<Signature> {
  <template>
    <div class='fitted-template' ...attributes>
      {{#if @isEmpty}}
        {{! empty links-to field }}
        <div data-test-empty-field class='empty-field'></div>
      {{else}}
        <div class='display-section'>
          {{#if @imageURL}}
            <div
              class='card-image'
              style={{cssUrl 'background-image' @imageURL}}
              data-test-card-image
            />
          {{else}}
            <@iconComponent data-test-card-type-icon class='card-type-icon' />
          {{/if}}
        </div>
        <div class='info-section'>
          <h3 class='card-title' data-test-card-title>{{@primary}}</h3>
          <h4 class='card-display-name' data-test-card-display-name>
            {{@secondary}}
          </h4>
        </div>
      {{/if}}
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      @layer {
        .fitted-template {
          width: 100%;
          height: 100%;
          display: flex;
          gap: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .display-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          padding: var(--boxel-sp);
          background-color: var(--boxel-300);
        }
        .card-image {
          background-position: center;
          background-size: contain;
          background-repeat: no-repeat;
          width: 100%;
          height: 100%;
        }
        .card-type-icon {
          aspect-ratio: 1 / 1;
          width: 52px;
          height: 52px;
          max-width: 100%;
          max-height: 100%;
        }
        .info-section {
          width: 100%;
          overflow: hidden;
          text-align: left;
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .card-title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          margin-block: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
          text-overflow: ellipsis;
        }
        .card-display-name {
          margin-top: var(--boxel-sp-4xs);
          margin-bottom: 0;
          color: var(--boxel-450);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
      }

      /* Aspect Ratio <= 1.0 (Vertical) */
      @container fitted-card (aspect-ratio <= 1.0) {
        .fitted-template {
          flex-direction: column;
        }
        .display-section {
          width: 100%;
          height: 70cqmax;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
        .display-section {
          display: none;
        }
      }
      /* Vertical Tiles*/
      /* Small Tile (150 x 170) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (170px <= height) {
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 3;
        }
      }
      /* CardsGrid Tile (170 x 250) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px < width < 250px ) and (170px < height < 275px) {
        .display-section {
          aspect-ratio: 1 / 1;
        }
        .card-title {
          -webkit-line-clamp: 2;
        }
      }
      /* Tall Tile (150 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (275px <= height) {
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 4;
        }
      }
      /* Large Tile (250 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
        .card-title {
          -webkit-line-clamp: 3;
        }
      }
      /* Vertical Cards */
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
        .fitted-template {
          gap: var(--boxel-sp);
        }
        .card-title {
          font-size: var(--boxel-font-size-med);
          -webkit-line-clamp: 4;
        }
      }

      /* Expanded Card (400 x 445) */
      /* 1.0 < Aspect Ratio (Horizontal) */
      @container fitted-card (1.0 < aspect-ratio) {
        .display-section {
          aspect-ratio: 1;
          max-width: 44%;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (height <= 65px) {
        .info-section {
          align-self: center;
        }
      }
      /* Badges */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
        .display-section {
          display: none;
        }
      }
      /* Small Badge (150 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
        .card-title {
          -webkit-line-clamp: 1;
          font: 600 var(--boxel-font-xs);
        }
        .card-display-name {
          margin-top: 0;
        }
      }
      /* Medium Badge (150 x 65) */

      /* Large Badge (150 x 105) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
        .card-title {
          -webkit-line-clamp: 3;
        }
      }

      /* Strips */
      /* Single Strip (250 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
        .fitted-template {
          padding: var(--boxel-sp-xxxs);
        }
        .card-display-name {
          display: none;
        }
      }

      /* Horizontal Tiles */
      /* Regular Tile (250 x 170) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }
      }

      /* Horizontal Cards */
      /* Compact Card  */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
        .display-section {
          height: 100%;
        }
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }

        @container fitted-card (height <= 65px) {
          .card-title {
            -webkit-line-clamp: 1;
            font-size: var(--boxel-font-size);
          }
        }
      }

      /* Full Card (400 x 275) */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
        .fitted-template {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
        .card-title {
          font-size: var(--boxel-font-size-med);
        }
      }
    </style>
  </template>
}

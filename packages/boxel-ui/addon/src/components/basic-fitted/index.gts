import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import cssUrl from 'ember-css-url';

interface Signature {
  Args: {
    description?: string;
    iconComponent?: ComponentLike<{
      Element: Element;
    }>;
    isEmpty?: boolean;
    primary: string;
    secondary?: string;
    thumbnailURL?: string;
  };
  Element: HTMLElement;
}

export default class BasicFitted extends Component<Signature> {
  <template>
    <article class='fitted-template' ...attributes>
      {{#if @isEmpty}}
        {{! empty links-to field }}
        <div data-test-empty-field class='empty-field'></div>
      {{else}}
        <div class='thumbnail-section'>
          {{#if @thumbnailURL}}
            <div
              class='card-thumbnail'
              style={{cssUrl 'background-image' @thumbnailURL}}
            >
              {{#unless @thumbnailURL}}
                <div
                  class='card-thumbnail-placeholder'
                  data-test-card-thumbnail-placeholder
                />
              {{/unless}}
            </div>
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
        <p class='card-description' data-test-card-description>
          {{@description}}
        </p>
      {{/if}}
    </article>
    <style scoped>
      @layer {
        .fitted-template {
          width: 100%;
          height: 100%;
          display: flex;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .thumbnail-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius-sm);
          overflow: hidden;
        }
        .card-thumbnail {
          display: flex;
          aspect-ratio: 1 / 1;
          align-items: center;
          justify-content: center;
          background-color: var(--boxel-teal);
          background-position: center;
          background-size: cover;
          background-repeat: no-repeat;
          width: 100%;
          height: 100%;
        }
        .card-type-icon {
          aspect-ratio: 1 / 1;
          width: 20%;
          min-width: 24px;
          max-width: 50px;
          height: auto;
          max-height: 100%;
        }
        .info-section {
          width: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .card-title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          margin-block: 0;
          font: 600 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
          text-overflow: ellipsis;
        }
        .card-display-name {
          margin-top: auto;
          margin-bottom: 0;
          color: var(--boxel-450);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        .card-description {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          overflow: hidden;
          margin-block: 0;
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
        }
      }

      /* Aspect Ratio <= 1.0 */

      @container fitted-card (aspect-ratio <= 1.0) {
        .fitted-template {
          flex-direction: column;
        }
        .card-description {
          display: none;
        }
        .thumbnail-section {
          width: 100%;
          height: 50cqmin;
        }
        .info-section {
          flex-grow: 1;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (118px < height) {
        .thumbnail-section {
          display: flex;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
        .thumbnail-section {
          display: none;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (170px <= height) {
        .thumbnail-section {
          min-height: 70px;
        }
        .card-title {
          -webkit-line-clamp: 3;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (275px <= height) {
        .thumbnail-section {
          min-height: 85px;
        }
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 4;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
        .thumbnail-section {
          min-height: 150px;
        }
        .card-title {
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 3;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
        .fitted-template {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
        .thumbnail-section {
          min-height: 236px;
        }
        .card-title {
          font-size: var(--boxel-font-size-med);
          -webkit-line-clamp: 4;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) and (445px <= height) {
        .thumbnail-section {
          min-height: 236px;
        }
      }

      /* 1.0 < Aspect Ratio */

      @container fitted-card (1.0 < aspect-ratio) {
        .card-description {
          display: none;
        }
        .thumbnail-section {
          aspect-ratio: 1;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (height < 65px) {
        .fitted-template {
          padding: var(--boxel-sp-xxxs);
        }
        .info-section {
          justify-content: center;
        }
        .card-title {
          -webkit-line-clamp: 1;
        }
        .thumbnail-section,
        .card-display-name {
          display: none;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (105px <= height) {
        .card-title {
          -webkit-line-clamp: 3;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
        .thumbnail-section {
          display: none;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (105px <= height) {
        .card-title {
          font-size: var(--boxel-font-size-sm);
          line-height: calc(17 / 13);
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (170px <= height) {
        .thumbnail-section {
          height: 40%;
        }
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
        .thumbnail-section {
          height: 100%;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
        .fitted-template {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
        .thumbnail-section {
          max-width: 44%;
        }
        .card-title {
          font-size: var(--boxel-font-size-med);
        }
      }
    </style>
  </template>
}

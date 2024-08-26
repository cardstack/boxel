import Component from '@glimmer/component';
import cssUrl from 'ember-css-url';

interface Signature {
  Args: {
    description: string;
    isEmpty?: boolean;
    primary: string;
    secondary: string;
    thumbnailURL: string;
  };
  Element: HTMLDivElement;
}

export default class BasicFitted extends Component<Signature> {
  <template>
    <div class='fitted-template'>
      {{#if @isEmpty}}
        {{! empty links-to field }}
        <div data-test-empty-field class='empty-field'></div>
      {{else}}
        <div class='thumbnail-section'>
          <div
            class='card-thumbnail'
            style={{cssUrl 'background-image' @thumbnailURL}}
          >
            {{#unless @thumbnailURL}}
              <div
                class='card-thumbnail-placeholder'
                data-test-card-thumbnail-placeholder
              ></div>
            {{/unless}}
          </div>
        </div>
        <div class='info-section'>
          <h3 class='card-title' data-test-card-title>{{@primary}}</h3>
          <h4 class='card-display-name' data-test-card-display-name>
            {{@secondary}}
          </h4>
        </div>
        <div
          class='card-description'
          data-test-card-description
        >{{@description}}</div>
      {{/if}}
    </div>
    <style>
      .fitted-template {
        width: 100%;
        height: 100%;
        display: flex;
      }

      /* Aspect Ratio <= 1.0 */

      @container fitted-card (aspect-ratio <= 1.0) {
        .fitted-template {
          align-content: flex-start;
          justify-content: center;
          padding: 10px;
          flex-wrap: wrap;
        }
        .card-title {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-align: center;
          margin: 10px 0 0 0;
        }
        .card-display-name {
          text-align: center;
          margin: var(--boxel-sp-xxs) 0 0 0;
        }
        .card-description {
          display: none;
        }
        .thumbnail-section {
          width: 100%;
        }
        .info-section {
          width: 100%;
        }
      }
      @container fitted-card (0.75 < aspect-ratio <= 1.0) {
        .thumbnail-section {
          /*
             64.35px is the computed height for the info section--at this particular
             aspect ratio break-point the height is the dominant axis for which to
             base the dimensions of the thumbnail
          */
          height: calc(100% - 64.35px);
        }
        .card-thumbnail {
          height: 100%;
        }
      }
      @container fitted-card (aspect-ratio <= 0.75) {
        .card-thumbnail {
          width: 100%;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and ((width < 150px) or (height < 150px)) {
        .card-title {
          font: 500 var(--boxel-font-xs);
          line-height: 1.27;
          letter-spacing: 0.11px;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width) and (150px <= height) {
        .card-title {
          font: 500 var(--boxel-font-sm);
          line-height: 1.23;
          letter-spacing: 0.13px;
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

      /* 1.0 < Aspect Ratio */

      @container fitted-card (1.0 < aspect-ratio) and (77px < height) {
        .card-title {
          -webkit-line-clamp: 2;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (height <= 77px) {
        .card-title {
          -webkit-line-clamp: 1;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (width < 200px) {
        .thumbnail-section {
          display: none;
        }
        .card-title {
          margin: 0;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (200px <= width) {
        .card-title {
          margin: 10px 0 0 0;
        }
      }

      /* 1.0 < Aspect Ratio <= 2.0 */

      @container fitted-card (1.0 < aspect-ratio <= 2.0) {
        .fitted-template {
          align-content: flex-start;
          justify-content: center;
          padding: 10px;
          column-gap: 10px;
        }
        .card-title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.25;
          letter-spacing: 0.16px;
        }
        .card-display-name {
          margin: var(--boxel-sp-xxs) 0 0 0;
        }
      }
      @container fitted-card (1.0 < aspect-ratio <= 2.0) and (width < 200px) {
        .thumbnail-section {
          display: none;
        }
        .card-title {
          margin: 0;
          font: 500 var(--boxel-font-size-sm);
        }
      }
      @container fitted-card (1.0 < aspect-ratio <= 2.0) and (200px <= width) {
        .card-title {
          margin: 10px 0 0 0;
          font: 500 var(--boxel-font-size-med);
        }
      }
      @container fitted-card (1.67 < aspect-ratio <= 2.0) {
        .fitted-template {
          flex-wrap: nowrap;
        }
        .thumbnail-section {
          width: 100%;
          height: 100%;
        }
        .info-section {
          width: 100%;
        }
        .card-description {
          display: none;
        }
        .card-thumbnail {
          /* at this breakpoint, the dominant axis is the height for
             thumbnail 1:1 aspect ratio calculations
          */
          height: 100%;
        }
      }
      @container fitted-card (1.0 < aspect-ratio <= 1.67) {
        .fitted-template {
          flex-wrap: wrap;
        }
        .thumbnail-section {
          flex: 1 auto;
          max-width: 50%;
          /* 24px is the computed height for the card description */
          height: calc(100% - 24px);
        }
        .info-section {
          flex: 1 auto;
          max-width: 50%;
        }
        .card-description {
          display: -webkit-box;
          flex: 1 100%;
        }
        .card-thumbnail {
          /* at this breakpoint, the dominant axis is the width for
             thumbnail 1:1 aspect ratio calculations
          */
          width: 100%;
        }
      }

      /* Aspect Ratio < 2.0 */

      @container fitted-card (2.0 < aspect-ratio) {
        .fitted-template {
          justify-content: center;
          padding: 10px;
          column-gap: 10px;
          flex-wrap: nowrap;
        }
        .card-title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
          line-height: 1.25;
          letter-spacing: 0.16px;
          font: 500 var(--boxel-font-size-med);
          margin: 0;
        }
        .card-display-name {
          margin: var(--boxel-sp-4xs) 0 0 0;
        }
        .thumbnail-section {
          flex: 1;
        }
        .info-section {
          flex: 4;
        }
        .card-description {
          display: none;
        }
      }
      @container fitted-card (2.0 < aspect-ratio) and (height <= 57px) {
        .fitted-template {
          padding: 6px;
        }
        .thumbnail-section {
          display: none;
        }
        .card-title {
          margin: 0;
        }
        .card-display-name {
          display: none;
        }
      }

      .default-fitted-template > * {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
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
        color: var(--boxel-light);
        border-radius: 6px;
      }
      .card-title {
        text-overflow: ellipsis;
      }
      .card-display-name {
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-450);
        line-height: 1.27;
        letter-spacing: 0.11px;
        text-overflow: ellipsis;
      }
      .card-description {
        margin: var(--boxel-sp-xxs) 0 0 0;
        font: 500 var(--boxel-font-xs);
        line-height: 1.27;
        letter-spacing: 0.11px;
        text-overflow: ellipsis;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .thumbnail-section {
        justify-content: center;
      }
    </style>
  </template>
}

import GlimmerComponent from '@glimmer/component';
import type { CardContext, BaseDef, CardDef } from '../card-api';
// @ts-ignore no types
import cssUrl from 'ember-css-url';
import { cardTypeDisplayName } from '@cardstack/runtime-common';

export default class DefaultEmbeddedTemplate extends GlimmerComponent<{
  Args: {
    cardOrField: typeof BaseDef;
    model: CardDef;
    fields: Record<string, new () => GlimmerComponent>;
    context?: CardContext;
  };
}> {
  <template>
    <div class='embedded-template'>
      {{#if @model}}
        <div class='thumbnail-section'>
          <div
            class='card-thumbnail'
            style={{cssUrl 'background-image' @model.thumbnailURL}}
          >
            {{#unless @model.thumbnailURL}}
              <div
                class='card-thumbnail-placeholder'
                data-test-card-thumbnail-placeholder
              ></div>
            {{/unless}}
          </div>
        </div>
        <div class='info-section'>
          <h3 class='card-title' data-test-card-title>{{@model.title}}</h3>
          <h4 class='card-display-name' data-test-card-display-name>
            {{cardTypeDisplayName @model}}
          </h4>
        </div>
        <div
          class='card-description'
          data-test-card-description
        >{{@model.description}}</div>
      {{else}}
        {{! empty links-to field }}
        <div data-test-empty-field class='empty-field'></div>
      {{/if}}
    </div>
    <style>
      .embedded-template {
        width: 100%;
        height: 100%;
        display: flex;
        padding: 10px;
        column-gap: 10px;
        flex-wrap: nowrap;
      }
      .card-title {
        margin: 10px 0 0 0;
        font: 500 var(--boxel-font-size-med);
        line-height: 1.25;
        letter-spacing: 0.16px;
      }
      .card-display-name {
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-450);
        line-height: 1.27;
        letter-spacing: 0.11px;
        margin: var(--boxel-sp-4xs) 0 0 0;
      }
      .thumbnail-section {
        flex: 1;
      }
      .info-section {
        flex: 4;
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
      .card-description {
        margin: var(--boxel-sp-xxs) 0 0 0;
        font: 500 var(--boxel-font-xs);
        line-height: 1.27;
        letter-spacing: 0.11px;
        overflow: hidden;
      }
      .thumbnail-section {
        justify-content: center;
      }

      @container embedded-card (width < 150px) {
        .card-title {
          font: 500 var(--boxel-font-sm);
          line-height: 1.23;
          letter-spacing: 0.13px;
        }
      }

      @container embedded-card (width < 200px) {
        .thumbnail-section {
          display: none;
        }
        .card-title {
          margin: 0;
        }
      }
    </style>
  </template>
}

import { Component } from 'https://cardstack.com/base/card-api';
// @ts-ignore
import type { ComponentLike } from '@glint/template';
// @ts-ignore
import cssUrl from 'ember-css-url';

import { action } from '@ember/object';
import { on } from '@ember/modifier';

import { type Listing } from '../listing/listing';

import { BoxelButton } from '@cardstack/boxel-ui/components';

export class ListingFittedTemplate extends Component<typeof Listing> {
  get firstImage() {
    return this.args.model.images?.[0];
  }

  get publisherInfo() {
    const hasPublisher = Boolean(this.args.model.publisher?.name);
    return hasPublisher ? 'By ' + this.args.model.publisher?.name : '';
  }

  @action remix(e) {
    e.stopPropagation();
    console.log('remix');
  }

  get hasTags() {
    return this.args.model.tags && this.args.model.tags?.length > 0;
  }

  get firstTagName() {
    return this.args.model.tags?.[0]?.name;
  }

  <template>
    <div class='fitted-template'>
      <div class='display-section'>
        {{#if @model.images}}
          <div
            class='card-image'
            style={{cssUrl 'background-image' this.firstImage}}
            data-test-card-image
          />
        {{else}}
          <@model.constructor.icon
            data-test-card-type-icon
            class='card-type-icon'
          />
        {{/if}}
      </div>
      <div class='info-section'>
        <div class='card-content'>
          <h3 class='card-title' data-test-card-title>{{@model.name}}</h3>
          <h4 class='card-display-name' data-test-card-display-name>
            {{this.publisherInfo}}
          </h4>
        </div>
        <div class='card-tags-action'>
          {{#if this.hasTags}}
            <span class='card-tags'># {{this.firstTagName}}</span>
          {{/if}}
          <BoxelButton
            @kind='primary'
            @size='extra-small'
            class='card-remix-button'
            {{on 'click' this.remix}}
          >
            Remix
          </BoxelButton>
        </div>
      </div>
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      @layer {
        .fitted-template {
          width: 100%;
          height: 100%;
          display: flex;
          overflow: hidden;
        }
        .display-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          padding: var(--boxel-sp);
          background-color: var(--boxel-200);
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
          display: flex;
          gap: var(--boxel-sp-sm);
          width: 100%;
          overflow: hidden;
          text-align: left;
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .card-tags-action {
          display: flex;
          align-items: end;
          flex-direction: column;
          flex-wrap: wrap;
          gap: var(--boxel-sp-sm);
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
        .card-tags {
          color: var(--boxel-400);
          font-size: var(--boxel-font-size-sm);
        }
        .card-remix-button {
          --boxel-button-font: 600 var(--boxel-font-sm);
          margin-left: auto;
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
        .info-section {
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          padding: var(--boxel-sp-xs);
        }
        .card-tags-action {
          flex-direction: row;
          justify-content: space-between;
        }
        .card-remix-button {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp);
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
        .card-display-name,
        .card-tags {
          display: none;
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
        .info-section {
          flex-direction: column;
          justify-content: space-between;
        }
        .card-tags-action {
          flex-direction: row;
          justify-content: space-between;
        }
        .card-tags {
          display: none;
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
        .card-title {
          font-size: var(--boxel-font-size-med);
        }
        .info-section {
          padding: var(--boxel-sp);
        }
      }

      /* Control Card which is Shorter than **px */
      @container fitted-card (aspect-ratio <= 1.0) and (height <= 275px) {
        .card-title {
          -webkit-line-clamp: 1;
        }
        .card-display-name {
          display: none;
        }
      }

      /* Control linked to many component fitted size */
      @container fitted-card (height <= 65px) {
        .display-section {
          padding: var(--boxel-sp-xs);
        }
        .card-tags-action {
          display: none;
        }
      }
    </style>
  </template>
}

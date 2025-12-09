import { Component, realmURL } from 'https://cardstack.com/base/card-api';
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import type {
  GetAllRealmMetasResult,
  RealmMetaField,
} from 'https://cardstack.com/base/command';

import { type Listing } from '../listing/listing';

import ChooseRealmAction from './choose-realm-action';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';

import { listingActions, isReady } from '../resources/listing-actions';

import { on } from '@ember/modifier';
import { CatalogImageOverlay } from './catalog-image-overlay';

export class ListingFittedTemplate extends Component<typeof Listing> {
  allRealmsInfoResource = commandData<typeof GetAllRealmMetasResult>(
    this,
    GetAllRealmMetasCommand,
  );

  get writableRealms(): { name: string; url: string; iconURL?: string }[] {
    const commandResource = this.allRealmsInfoResource;
    if (commandResource?.isSuccess && commandResource) {
      const result = commandResource.value;
      if (result?.results) {
        return result.results
          .filter(
            (realmMeta: RealmMetaField) =>
              realmMeta.canWrite &&
              realmMeta.url !== this.args.model[realmURL]?.href,
          )
          .map((realmMeta: RealmMetaField) => ({
            name: realmMeta.info.name,
            url: realmMeta.url,
            iconURL: realmMeta.info.iconURL,
          }));
      }
    }
    return [];
  }

  actionsResource = listingActions(this, () => ({
    listing: this.args.model as Listing,
  }));

  get images() {
    return this.args.model.images ?? [];
  }

  get firstImage() {
    return this.args.model.images?.[0];
  }

  get publisherInfo() {
    const hasPublisher = Boolean(this.args.model.publisher?.name);
    return hasPublisher ? 'By ' + this.args.model.publisher?.name : '';
  }

  get hasTags() {
    return this.args.model.tags && this.args.model.tags.length > 0;
  }

  get firstTagName() {
    return this.args.model.tags?.[0]?.name;
  }

  get listingActions() {
    if (isReady(this.actionsResource)) {
      return this.actionsResource.actions;
    }
    return;
  }

  get stubActions() {
    return this.listingActions?.type === 'stub'
      ? this.listingActions
      : undefined;
  }

  get skillActions() {
    return this.listingActions?.type === 'skill'
      ? this.listingActions
      : undefined;
  }

  get regularActions() {
    return this.listingActions?.type === 'regular'
      ? this.listingActions
      : undefined;
  }

  get themeActions() {
    return this.listingActions?.type === 'theme'
      ? this.listingActions
      : undefined;
  }

  viewDetails = () => {
    this.listingActions?.view();
  };

  <template>
    {{#if this.listingActions}}
      <div class='fitted-template'>
        <div class='display-section'>
          <CatalogImageOverlay
            @listingActions={{this.listingActions}}
            @images={{this.images}}
          >
            <:icon>
              <@model.constructor.icon
                data-test-card-type-icon
                class='card-type-icon'
              />
            </:icon>
          </CatalogImageOverlay>
        </div>
        <div
          class='info-section'
          tabindex='0'
          data-test-catalog-listing-fitted-details
          aria-label='View Listing Details'
          {{on 'click' this.viewDetails}}
        >
          <div class='card-content'>
            <h3 class='card-title' data-test-card-title={{@model.name}}>
              {{@model.name}}
            </h3>
            <p class='card-display-name' data-test-card-display-name>
              {{this.publisherInfo}}
            </p>
          </div>
          <div class='card-tags-action'>
            {{#if this.hasTags}}
              <span class='card-tags'># {{this.firstTagName}}</span>
            {{/if}}
            {{#if this.stubActions}}
              <ChooseRealmAction
                @name='Build'
                @writableRealms={{this.writableRealms}}
                @onAction={{this.stubActions.build}}
                @context={{@context}}
                @size='extra-small'
              />
            {{else if this.skillActions}}
              {{#if this.skillActions.remix}}
                <ChooseRealmAction
                  @name='Remix'
                  @writableRealms={{this.writableRealms}}
                  @onAction={{this.skillActions.remix}}
                  @context={{@context}}
                  @size='extra-small'
                />
              {{/if}}
            {{else if this.regularActions}}
              {{#if this.regularActions.remix}}
                <ChooseRealmAction
                  @name='Remix'
                  @writableRealms={{this.writableRealms}}
                  @onAction={{this.regularActions.remix}}
                  @context={{@context}}
                  @size='extra-small'
                />
              {{/if}}
            {{else if this.themeActions}}
              {{#if this.themeActions.remix}}
                <ChooseRealmAction
                  @name='Remix'
                  @writableRealms={{this.writableRealms}}
                  @onAction={{this.themeActions.remix}}
                  @context={{@context}}
                  @size='extra-small'
                />
              {{/if}}
            {{/if}}
          </div>
        </div>

      </div>
    {{/if}}

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
        .fitted-template :deep(.ember-basic-dropdown-content-placeholder) {
          display: none;
        }
        .fitted-template :deep(.ember-basic-dropdown-content-wormhole-origin) {
          position: absolute;
        }
        .display-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          background-color: var(--boxel-200);
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
          min-height: 15px;
        }
        .card-tags {
          color: var(--boxel-400);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1 1 auto;
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
          height: 68cqmax;
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
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 3;
        }
      }
      /* CardsGrid Tile (170 x 250) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px < width < 250px ) and (170px < height < 275px) {
        .display-section {
          height: 55cqmax;
        }
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 1;
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
          -webkit-line-clamp: 1;
        }
      }
      /* Large Tile (250 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
        .card-title {
          -webkit-line-clamp: 1;
        }
      }
      /* Vertical Cards */
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
        .card-title {
          font-size: var(--boxel-font-size-md);
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
          font-size: var(--boxel-font-size-md);
        }
        .info-section {
          padding: var(--boxel-sp);
        }
      }

      /* Control Card which is Smaller than */
      @container fitted-card (aspect-ratio <= 1.0) and (width <= 275px) {
        .card-tags {
          display: none;
        }
      }

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

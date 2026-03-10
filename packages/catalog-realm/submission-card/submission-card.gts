import { on } from '@ember/modifier';

import {
  CardDef,
  FieldDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import type { Query } from '@cardstack/runtime-common';

import { or } from '@cardstack/boxel-ui/helpers';
import { BoxelButton } from '@cardstack/boxel-ui/components';

import BotIcon from '@cardstack/boxel-icons/bot';
import FileCodeIcon from '@cardstack/boxel-icons/file-code';
import GitBranchIcon from '@cardstack/boxel-icons/git-branch';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import MessageIcon from '@cardstack/boxel-icons/message';

import { Listing } from '../catalog-app/listing/listing';
import { buildRealmHrefs } from '../pr-card/utils';

export class FileContentField extends FieldDef {
  @field filename = contains(StringField);
  @field contents = contains(StringField);

  static atom = class Atom extends Component<typeof FileContentField> {
    get filename() {
      return this.args.model.filename ?? 'Untitled';
    }

    <template>
      <span class='file-atom'>
        <FileCodeIcon class='file-atom-icon' width='12' height='12' />
        <span class='file-atom-name'>{{this.filename}}</span>
      </span>
      <style scoped>
        .file-atom {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          background: var(--muted, #f6f8fa);
          border-radius: var(--boxel-border-radius-sm);
          max-width: 100%;
          overflow: hidden;
        }

        .file-atom-icon {
          flex-shrink: 0;
          color: var(--muted-foreground, #656d76);
        }

        .file-atom-name {
          font-size: var(--boxel-font-size-2xs);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: var(--foreground, #1f2328);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof FileContentField> {
    get filename() {
      return this.args.model.filename ?? 'Untitled';
    }

    get preview() {
      const contents = this.args.model.contents ?? '';
      return contents.split('\n').slice(0, 6).join('\n');
    }

    get lineCount() {
      const contents = this.args.model.contents ?? '';
      return contents ? contents.split('\n').length : 0;
    }

    <template>
      <div class='file-embedded'>
        <div class='file-header'>
          <FileCodeIcon class='file-header-icon' width='14' height='14' />
          <span class='file-name'>{{this.filename}}</span>
          {{#if this.lineCount}}
            <span class='line-badge'>{{this.lineCount}}
              line{{#if (isPlural this.lineCount)}}s{{/if}}</span>
          {{/if}}
        </div>
        {{#if this.preview}}
          <pre class='file-preview'>{{this.preview}}</pre>
        {{/if}}
      </div>
      <style scoped>
        .file-embedded {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border, #d0d7de);
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          background: var(--card, #ffffff);
        }

        .file-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          background: var(--muted, #f6f8fa);
          border-bottom: 1px solid var(--border, #d0d7de);
          min-width: 0;
        }

        .file-header-icon {
          flex-shrink: 0;
          color: var(--muted-foreground, #656d76);
        }

        .file-name {
          flex: 1;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: var(--foreground, #1f2328);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .line-badge {
          flex-shrink: 0;
          font-size: var(--boxel-font-size-2xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-sm);
          padding: 1px 5px;
          background: var(--muted, #f6f8fa);
          color: var(--muted-foreground, #656d76);
          border-radius: var(--boxel-border-radius-sm);
          white-space: nowrap;
        }

        .file-preview {
          margin: 0;
          padding: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-2xs);
          font-weight: 400;
          font-family: var(--boxel-monospace-font-family);
          line-height: 1.6;
          color: var(--muted-foreground, #656d76);
          white-space: pre;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 6;
        }
      </style>
    </template>
  };
}

export class SubmissionCard extends CardDef {
  static displayName = 'SubmissionCard';
  static icon = BotIcon;

  @field cardTitle = contains(StringField, {
    computeVia: function (this: SubmissionCard) {
      return (
        this.listing?.name ?? this.listing?.cardTitle ?? 'Untitled Submission'
      );
    },
  });
  @field roomId = contains(StringField);
  @field branchName = contains(StringField);
  @field listing = linksTo(() => Listing);
  @field allFileContents = containsMany(FileContentField);

  static fitted = class Fitted extends Component<typeof SubmissionCard> {
    get listingName() {
      return (
        this.args.model.listing?.name ?? this.args.model.listing?.cardTitle
      );
    }

    get title() {
      return this.args.model.cardTitle;
    }

    get branchName() {
      return this.args.model.branchName;
    }

    get roomId() {
      return this.args.model.roomId;
    }

    get listingImage() {
      return this.args.model.listing?.images?.[0];
    }

    openListing = (e: Event) => {
      e.stopPropagation();
      const listing = this.args.model.listing;
      if (listing) {
        this.args.viewCard?.(listing, 'isolated');
      }
    };

    // ── PrCard live query ──
    get realmHrefs() {
      return buildRealmHrefs(this.args.model[realmURL]?.href);
    }

    get prCardQuery(): Query | undefined {
      if (!this.args.model.branchName) return undefined;
      return {
        filter: {
          on: {
            module: new URL('../pr-card/pr-card', import.meta.url).href,
            name: 'PrCard',
          },
          eq: { branchName: this.args.model.branchName },
        },
      };
    }

    prCardData = this.args.context?.getCards(
      this,
      () => this.prCardQuery,
      () => this.realmHrefs,
      { isLive: true },
    );

    get prCardInstance() {
      return this.prCardData?.instances?.[0] ?? null;
    }

    openPrCard = (e: Event) => {
      e.stopPropagation();
      if (this.prCardInstance) {
        this.args.viewCard?.(this.prCardInstance, 'isolated');
      }
    };

    openSubmission = (e: Event) => {
      e.stopPropagation();
      this.args.viewCard?.(this.args.model, 'isolated');
    };

    <template>
      <article class='submission-fitted'>
        <header class='image-icon-section'>
          {{#if this.listingImage}}
            <img
              class='listing-image'
              src={{this.listingImage}}
              alt={{this.listingName}}
            />
          {{else}}
            <@model.constructor.icon class='card-icon' />
          {{/if}}
          {{#if @model.listing}}
            <div class='hover-overlay'>
              <BoxelButton
                @kind='primary'
                @size='extra-small'
                class='footer-button details-button overlay-button'
                aria-label='View listing'
                {{on 'click' this.openListing}}
              >
                View Listing
              </BoxelButton>
            </div>
          {{/if}}
        </header>
        <section class='info-section'>
          <button
            type='button'
            class='info-main-button'
            aria-label='View submission details'
            {{on 'click' this.openSubmission}}
          >
            <span class='title'>{{this.title}}</span>
          {{#if this.branchName}}
            <span class='branch-name'>
              <span class='meta-label'>
                <GitBranchIcon class='meta-icon' width='10' height='10' />Branch
              </span>
              <span class='meta-value'>{{this.branchName}}</span>
            </span>
          {{/if}}
          {{#if this.roomId}}
            <span class='room-id'>
              <span class='meta-label'>
                <MessageIcon class='meta-icon' width='10' height='10' />Room
              </span>
              <span class='meta-value'>{{this.roomId}}</span>
            </span>
          {{/if}}
          </button>
          <footer class='footer'>
            {{#if this.prCardInstance}}
              <BoxelButton
                @kind='secondary-dark'
                @size='extra-small'
                class='footer-button view-pr-button'
                aria-label='View PR card'
                {{on 'click' this.openPrCard}}
              >
                <GitPullRequestIcon width='12' height='12' />View PR
              </BoxelButton>
            {{/if}}
            <BoxelButton
              @kind='primary'
              @size='extra-small'
              class='footer-button details-button'
              aria-label='View submission details'
              {{on 'click' this.openSubmission}}
            >
              View Details
            </BoxelButton>
          </footer>
        </section>
      </article>

      <style scoped>
        /* ── Base (horizontal default) ─────────────────────────────── */
        .submission-fitted {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: row;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
          box-sizing: border-box;
          background: var(--card, #ffffff);
        }

        .image-icon-section {
          position: relative;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--muted, #f6f8fa);
          border: 1px solid var(--border, #d0d7de);
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          aspect-ratio: 1;
          max-width: 44%;
        }

        .listing-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .card-icon {
          width: 52%;
          height: 52%;
          color: var(--primary, #0969da);
        }

        .info-section {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          overflow: hidden;
        }

        .info-main-button {
          appearance: none;
          border: none;
          background: transparent;
          padding: 0;
          margin: 0;
          width: 100%;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          align-items: flex-start;
          text-align: left;
          color: inherit;
          cursor: pointer;
        }

        .title {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.3;
          text-align: left;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          color: var(--foreground, #1f2328);
        }

        .branch-name,
        .room-id {
          display: none;
          width: 100%;
          align-items: end;
          gap: var(--boxel-sp-5xs);
          min-width: 0;
        }

        .meta-label {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
          font-size: var(--boxel-font-size-2xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-xl);
          text-transform: uppercase;
          color: var(--muted-foreground, #656d76);
        }

        .meta-icon {
          color: var(--muted-foreground, #656d76);
        }

        .meta-value {
          flex: 1;
          min-width: 0;
          font-size: var(--boxel-font-size-2xs);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: var(--foreground, #1f2328);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── Hover overlay on image ─────────────────────────────── */
        .hover-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          opacity: 0;
          background-color: rgba(0, 0, 0, 0.6);
          transition: opacity 0.3s ease;
          pointer-events: none;
        }

        .image-icon-section:hover .hover-overlay {
          opacity: 1;
          pointer-events: auto;
        }

        .overlay-button {
          --boxel-button-font: 600 var(--boxel-font-xs);
          --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          pointer-events: auto;
          white-space: nowrap;
        }

        /* ── Footer ───────────────────────────────────────────── */
        .footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--boxel-sp-4xs);
          margin-top: auto;
          width: 100%;
        }

        .footer-button {
          --boxel-button-font: 600 var(--boxel-font-xs);
          --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          flex: 0 0 auto;
          line-height: 1;
        }

        .view-pr-button {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs);
          --boxel-button-color: var(--muted, #f6f8fa);
          --boxel-button-text-color: var(--foreground, #1f2328);
          --boxel-button-border: 1px solid var(--border, #d0d7de);
        }

        /* ── Vertical (aspect-ratio ≤ 1.0) ──────────────────────── */
        @container fitted-card (aspect-ratio <= 1.0) {
          .submission-fitted {
            flex-direction: column;
          }

          .image-icon-section {
            width: 100%;
            height: 50cqmax;
            max-width: none;
            aspect-ratio: auto;
          }

          .info-section {
            flex-direction: column;
            justify-content: space-between;
            height: 100%;
            padding: var(--boxel-sp-xs);
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
          .image-icon-section {
            display: none;
          }
        }

        /* Small Tile (150 x 170) */
        @container fitted-card (aspect-ratio <= 1.0) and (150px <= width) and (170px <= height) {
          .title {
            font-size: var(--boxel-font-size-sm);
            -webkit-line-clamp: 3;
          }
        }

        /* CardsGrid Tile (170 x 250) */
        @container fitted-card (aspect-ratio <= 1.0) and (150px < width < 250px) and (170px < height < 275px) {
          .image-icon-section {
            height: 55cqmax;
          }

          .title {
            font-size: var(--boxel-font-size);
            -webkit-line-clamp: 1;
          }

          .branch-name,
          .room-id {
            display: none;
          }
        }

        /* Tall Tile (150 x 275) */
        @container fitted-card (aspect-ratio <= 1.0) and (150px <= width) and (275px <= height) {
          .title {
            font-size: var(--boxel-font-size);
            -webkit-line-clamp: 1;
          }

          .branch-name,
          .room-id {
            display: flex;
          }
        }

        /* Large Tile (250 x 275) */
        @container fitted-card (aspect-ratio <= 1.0) and (250px <= width) and (275px <= height) {
          .title {
            -webkit-line-clamp: 1;
          }

          .meta-value {
            font-size: var(--boxel-font-size-xs);
          }
        }

        /* Vertical Cards (400w+) */
        @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
          .title {
            font-size: var(--boxel-font-size-md);
            -webkit-line-clamp: 4;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (width <= 275px) {
          .footer {
            flex-wrap: wrap;
          }
        }

        @container fitted-card (aspect-ratio <= 1.0) and (height <= 275px) {
          .title {
            -webkit-line-clamp: 1;
          }

          .branch-name,
          .room-id {
            display: none;
          }
        }

        /* ── Horizontal (aspect-ratio > 1.0) ─────────────────────── */
        @container fitted-card (1.0 < aspect-ratio) {
          .image-icon-section {
            aspect-ratio: 1;
            max-width: 30%;
          }

          .info-section {
            flex-direction: column;
            justify-content: space-between;
          }
        }

        @container fitted-card (1.0 < aspect-ratio) and (height <= 65px) {
          .info-section {
            align-self: center;
          }

          .footer,
          .hover-overlay {
            display: none;
          }
        }

        /* Badges (width < 250px) */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
          .image-icon-section {
            display: none;
          }
        }

        /* Small Badge (< 250w, < 65h) */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
          .title {
            -webkit-line-clamp: 1;
            font: 600 var(--boxel-font-xs);
          }
        }

        /* Large Badge (< 250w, 105h+) */
        @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
          .title {
            -webkit-line-clamp: 3;
          }
        }

        /* Strips (250w+, < 65h) */
        @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
          .submission-fitted {
            padding: var(--boxel-sp-xxxs);
          }

          .branch-name,
          .room-id {
            display: none;
          }
        }

        /* Regular Tile (250–400w, 170h+) */
        @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
          .title {
            -webkit-line-clamp: 4;
            font-size: var(--boxel-font-size);
          }

          .branch-name,
          .room-id {
            display: flex;
          }
        }

        /* Compact Card (400w+, 170h+) */
        @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
          .image-icon-section {
            height: 100%;
          }

          .title {
            -webkit-line-clamp: 4;
            font-size: var(--boxel-font-size);
          }

          .branch-name,
          .room-id {
            display: flex;
          }

          .meta-value {
            font-size: var(--boxel-font-size-xs);
          }
        }

        /* Full Card (400w+, 275h+) */
        @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
          .title {
            font-size: var(--boxel-font-size-md);
          }

          .info-section {
            padding: var(--boxel-sp);
          }
        }

        /* ── Global: compact buttons for smaller cards ─────────── */
        @container fitted-card (width < 400px) {
          .footer-button {
            --boxel-button-font: 600 var(--boxel-font-xs);
            --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          }

          .overlay-button {
            --boxel-button-font: 600 var(--boxel-font-xs);
            --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          }
        }

        /* ── Global: height ≤ 65px ───────────────────────────────── */
        @container fitted-card (height <= 65px) {
          .image-icon-section {
            padding: var(--boxel-sp-xs);
          }

          .footer,
          .hover-overlay {
            display: none;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof SubmissionCard> {
    get fileCount() {
      return this.args.model.allFileContents?.length ?? 0;
    }

    get listingName() {
      return (
        this.args.model.listing?.name ?? this.args.model.listing?.cardTitle
      );
    }

    get title() {
      return this.args.model.cardTitle;
    }

    get branchName() {
      return this.args.model.branchName;
    }

    get roomId() {
      return this.args.model.roomId;
    }

    get listingImage() {
      return this.args.model.listing?.images?.[0];
    }

    openListing = () => {
      const listing = this.args.model.listing;
      if (listing) {
        this.args.viewCard?.(listing, 'isolated');
      }
    };

    // ── PrCard live query ──
    get realmHrefs() {
      return buildRealmHrefs(this.args.model[realmURL]?.href);
    }

    get prCardQuery(): Query | undefined {
      if (!this.args.model.branchName) return undefined;
      return {
        filter: {
          on: {
            module: new URL('../pr-card/pr-card', import.meta.url).href,
            name: 'PrCard',
          },
          eq: { branchName: this.args.model.branchName },
        },
      };
    }

    prCardData = this.args.context?.getCards(
      this,
      () => this.prCardQuery,
      () => this.realmHrefs,
      { isLive: true },
    );

    get prCardInstance() {
      return this.prCardData?.instances?.[0] ?? null;
    }

    openPrCard = () => {
      if (this.prCardInstance) {
        this.args.viewCard?.(this.prCardInstance, 'isolated');
      }
    };

    <template>
      <div class='submission-isolated'>

        {{! ── Dark hero: info left, image right ── }}
        <div class='submission-hero'>
          <div class='hero-info'>
            {{#if this.listingName}}
              <p class='submitted-to-label'>Submitted to</p>
              <h1 class='listing-name'>{{this.listingName}}</h1>
            {{else}}
              <h1 class='listing-name'>{{this.title}}</h1>
            {{/if}}

            {{#if (or this.branchName this.roomId)}}
              <div class='meta-rows'>
                {{#if this.branchName}}
                  <div class='meta-item'>
                    <span class='meta-item-label'>
                      <GitBranchIcon
                        class='meta-item-icon'
                        width='11'
                        height='11'
                      />Branch
                    </span>
                    <span class='meta-item-value'>{{this.branchName}}</span>
                  </div>
                {{/if}}
                {{#if this.roomId}}
                  <div class='meta-item'>
                    <span class='meta-item-label'>
                      <MessageIcon
                        class='meta-item-icon'
                        width='11'
                        height='11'
                      />Room
                    </span>
                    <span class='meta-item-value'>{{this.roomId}}</span>
                  </div>
                {{/if}}
              </div>
            {{/if}}

            <div class='meta-actions'>
              {{#if this.fileCount}}
                <span class='file-count-badge'>
                  <FileCodeIcon width='12' height='12' />
                  {{this.fileCount}}
                  file{{#if (isPlural this.fileCount)}}s{{/if}}
                </span>
              {{/if}}
              {{#if this.prCardInstance}}
                <BoxelButton
                  @kind='secondary-dark'
                  class='view-pr-btn'
                  aria-label='View PR card'
                  {{on 'click' this.openPrCard}}
                >
                  <GitPullRequestIcon width='14' height='14' />View PR
                </BoxelButton>
              {{/if}}
            </div>
          </div>

          <div class='hero-image'>
            {{#if this.listingImage}}
              <img
                class='listing-image'
                src={{this.listingImage}}
                alt={{this.listingName}}
              />
            {{else}}
              <@model.constructor.icon class='listing-icon' />
            {{/if}}
            {{#if @model.listing}}
              <div class='hero-image-overlay'>
                <BoxelButton
                  @kind='primary'
                  @size='extra-small'
                  class='details-button view-listing-btn'
                  aria-label='View listing details'
                  {{on 'click' this.openListing}}
                >
                  View Listing
                </BoxelButton>
              </div>
            {{/if}}
          </div>
        </div>

        {{! ── Files grid ── }}
        {{#if this.fileCount}}
          <section class='files-section'>
            <h2 class='section-heading'>
              <FileCodeIcon class='section-icon' width='13' height='13' />Files
              <span class='section-count'>{{this.fileCount}}</span>
            </h2>
            <div class='files-grid'>
              {{#each @fields.allFileContents as |FileContent|}}
                <FileContent />
              {{/each}}
            </div>
          </section>
        {{/if}}
      </div>

      <style scoped>
        /* ── Root ───────────────────────────────────────────────── */
        .submission-isolated {
          container-type: inline-size;
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow-y: auto;
          background: var(--card, #ffffff);
        }

        /* ── Dark hero: two-column grid ─────────────────────────── */
        .submission-hero {
          display: grid;
          grid-template-columns: 1fr 320px;
          min-height: 260px;
          background: #1e293b;
          flex-shrink: 0;
        }

        /* Left column */
        .hero-info {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xl);
          min-width: 0;
        }

        .submitted-to-label {
          margin: 0;
          font-size: var(--boxel-font-size-2xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-xl);
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.45);
        }

        .listing-name {
          margin: 0;
          font: 700 var(--boxel-font-xl);
          color: #fff;
          line-height: 1.2;
        }

        /* Meta rows (branch / room) */
        .meta-rows {
          display: flex;
          flex-direction: column;
          gap: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: var(--boxel-sp-sm);
          margin-top: var(--boxel-sp-xs);
        }

        .meta-item {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp-xs) 0;
          min-width: 0;
        }

        .meta-item + .meta-item {
          border-top: 1px solid rgba(255, 255, 255, 0.07);
        }

        .meta-item-label {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: var(--boxel-font-size-2xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-xl);
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.4);
        }

        .meta-item-value {
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: rgba(255, 255, 255, 0.85);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* Actions (file count + View PR) */
        .meta-actions {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
          padding-top: var(--boxel-sp-sm);
          margin-top: var(--boxel-sp-xs);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .file-count-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-sm);
          padding: 4px 10px;
          background: rgba(255, 255, 255, 0.12);
          color: rgba(255, 255, 255, 0.85);
          border-radius: var(--boxel-border-radius-sm);
          white-space: nowrap;
        }

        .view-pr-btn {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          --boxel-button-font: 600 var(--boxel-font-xs);
          --boxel-button-padding: 4px 10px;
          --boxel-button-text-color: rgba(255, 255, 255, 0.7);
          --boxel-button-border: 1px solid rgba(255, 255, 255, 0.25);
          white-space: nowrap;
        }

        .view-pr-btn:hover {
          --boxel-button-text-color: #fff;
          --boxel-button-border: 1px solid rgba(255, 255, 255, 0.6);
        }

        /* Right column — listing image or icon */
        .hero-image {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.25);
        }

        .listing-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .listing-icon {
          width: 80px;
          height: 80px;
          color: rgba(255, 255, 255, 0.2);
        }

        .hero-image-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: rgba(0, 0, 0, 0.6);
        }

        .view-listing-btn {
          --boxel-button-font: 600 var(--boxel-font-sm);
          white-space: nowrap;
        }

        /* ── Narrow container: stack image above info ────────────── */
        @container (max-width: 560px) {
          .submission-hero {
            grid-template-columns: 1fr;
          }

          .hero-image {
            height: 180px;
            order: -1;
          }

          .hero-info {
            padding: var(--boxel-sp-lg);
          }
        }

        /* ── Files section ──────────────────────────────────────── */
        .files-section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-lg);
        }

        .section-heading {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-xl);
          text-transform: uppercase;
          color: var(--muted-foreground, #656d76);
        }

        .section-icon {
          color: var(--muted-foreground, #656d76);
        }

        .section-count {
          margin-left: var(--boxel-sp-4xs);
          padding: 1px 6px;
          background: var(--muted, #f6f8fa);
          color: var(--muted-foreground, #656d76);
          border-radius: var(--boxel-border-radius-sm);
          font-size: var(--boxel-font-size-2xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
        }

        .files-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };
}

function isPlural(count: number): boolean {
  return count !== 1;
}

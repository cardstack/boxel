import {
  CardDef,
  FieldDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { or } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import StringField from 'https://cardstack.com/base/string';
import BotIcon from '@cardstack/boxel-icons/bot';
import BrandGithubIcon from '@cardstack/boxel-icons/brand-github';
import FileCodeIcon from '@cardstack/boxel-icons/file-code';
import GitBranchIcon from '@cardstack/boxel-icons/git-branch';
import MessageIcon from '@cardstack/boxel-icons/message';
import { Listing } from '../catalog-app/listing/listing';

const GITHUB_BRANCH_URL_PREFIX =
  'https://github.com/cardstack/boxel-catalog/tree/';

function encodeBranchName(branchName: string): string {
  return branchName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

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
          background: var(--boxel-200);
          border-radius: var(--boxel-border-radius-sm);
          max-width: 100%;
          overflow: hidden;
        }

        .file-atom-icon {
          flex-shrink: 0;
          color: var(--boxel-450);
        }

        .file-atom-name {
          font-size: var(--boxel-font-size-2xs);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: var(--boxel-600);
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
          border: 1px solid var(--boxel-border-color);
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          background: var(--boxel-light);
        }

        .file-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          background: var(--boxel-200);
          border-bottom: 1px solid var(--boxel-border-color);
          min-width: 0;
        }

        .file-header-icon {
          flex-shrink: 0;
          color: var(--boxel-450);
        }

        .file-name {
          flex: 1;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: var(--boxel-dark);
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
          background: var(--boxel-300);
          color: var(--boxel-600);
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
          color: var(--boxel-600);
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
  @field githubURL = contains(StringField, {
    computeVia: function (this: SubmissionCard) {
      if (!this.branchName) {
        return undefined;
      }
      return `${GITHUB_BRANCH_URL_PREFIX}${encodeBranchName(this.branchName)}`;
    },
  });
  @field listing = linksTo(() => Listing);
  @field allFileContents = containsMany(FileContentField);

  static fitted = class Fitted extends Component<typeof SubmissionCard> {
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

    get githubURL() {
      return this.args.model.githubURL;
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

    <template>
      <div class='submission-fitted'>
        <div class='image-icon-section'>
          {{#if this.listingImage}}
            <img
              class='listing-image'
              src={{this.listingImage}}
              alt={{this.listingName}}
            />
          {{else}}
            <@model.constructor.icon class='card-icon' />
          {{/if}}
        </div>
        <div class='info-section'>
          <h3 class='title'>{{this.title}}</h3>
          {{#if this.branchName}}
            <p class='branch-name'>
              <span class='meta-label'>
                <GitBranchIcon class='meta-icon' width='10' height='10' />Branch
              </span>
              <span class='meta-value'>{{this.branchName}}</span>
            </p>
          {{/if}}
          {{#if this.roomId}}
            <p class='room-id'>
              <span class='meta-label'>
                <MessageIcon class='meta-icon' width='10' height='10' />Room
              </span>
              <span class='meta-value'>{{this.roomId}}</span>
            </p>
          {{/if}}
          <div class='footer'>
            {{#if this.fileCount}}
              <span class='file-badge'>{{this.fileCount}}
                file{{#if (isPlural this.fileCount)}}s{{/if}}</span>
            {{/if}}
            {{#if this.githubURL}}
              <a
                class='github-link'
                href={{this.githubURL}}
                target='_blank'
                rel='noopener noreferrer'
                aria-label='View on GitHub'
              >
                <BrandGithubIcon width='12' height='12' />
              </a>
            {{/if}}
          </div>
        </div>
      </div>

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
        }

        /*
         * Fixed explicit sizes per breakpoint so the icon never derives
         * its width from the container height on horizontal rectangle cards.
         */
        .image-icon-section {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--boxel-200);
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
          width: 60px;
          height: 60px;
          align-self: center;
          overflow: hidden;
        }

        .listing-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: var(--boxel-border-radius);
        }

        .card-icon {
          width: 52%;
          height: 52%;
          color: var(--boxel-blue);
        }

        .info-section {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          overflow: hidden;
        }

        .title {
          margin: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.3;
          text-align: left;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          color: var(--boxel-dark);
        }

        .branch-name,
        .room-id {
          display: none;
          margin: 0;
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
          font: 600 var(--boxel-font-size-2xs) var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-xl);
          text-transform: uppercase;
          color: var(--boxel-400);
        }

        .meta-icon {
          color: var(--boxel-400);
        }

        .meta-value {
          flex: 1;
          font: 500 var(--boxel-font-size-xs) var(--boxel-monospace-font-family);
          color: var(--boxel-600);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .footer {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          margin-top: auto;
        }

        .file-badge {
          font: 600 var(--boxel-font-size-2xs) var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-sm);
          padding: 2px 6px;
          background: #e0f2fe;
          color: #0369a1;
          border-radius: var(--boxel-border-radius-sm);
          white-space: nowrap;
        }

        .github-link {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--boxel-450);
          border-radius: var(--boxel-border-radius-sm);
          text-decoration: none;
          transition: color 0.15s;
          flex-shrink: 0;
        }

        .github-link:hover {
          color: var(--boxel-dark);
        }

        /* ── Vertical layout (square tiles & tall cards) ───────────── */
        @container fitted-card (aspect-ratio <= 1.0) {
          .submission-fitted {
            flex-direction: column;
            padding: var(--boxel-sp-xs);
            gap: var(--boxel-sp-4xs);
          }

          /* Fill full width, proportional height based on container */
          .image-icon-section {
            width: 100%;
            height: 46cqmin;
            align-self: auto;
          }

          .info-section {
            align-items: flex-start;
          }

          .title {
            -webkit-line-clamp: 2;
          }
        }

        /* Small vertical tile: trim icon */
        @container fitted-card (aspect-ratio <= 1.0) and (height <= 190px) {
          .image-icon-section {
            height: 38cqmin;
          }
        }

        /* Compact vertical tile: hide footer, 1-line title */
        @container fitted-card (aspect-ratio <= 1.0) and (height <= 140px) {
          .footer {
            display: none;
          }

          .title {
            -webkit-line-clamp: 1;
            font-size: var(--boxel-font-size-xs);
          }
        }

        /* Tiny vertical: hide icon, just title */
        @container fitted-card (aspect-ratio <= 1.0) and (height <= 80px) {
          .image-icon-section {
            display: none;
          }

          .title {
            font-size: var(--boxel-font-size-xs);
          }
        }

        /* ── Large vertical card: tall portrait ─────────────────────── */
        /* Show extra fields, larger image; font stays modest on narrow cards */
        @container fitted-card (aspect-ratio <= 1.0) and (275px <= height) {
          .submission-fitted {
            padding: var(--boxel-sp-sm);
            gap: var(--boxel-sp-xs);
          }

          .image-icon-section {
            height: 55cqmin;
          }

          .title {
            line-height: 1.5rem;
            -webkit-line-clamp: 2;
          }

          .branch-name,
          .room-id {
            display: flex;
          }

          .file-list {
            display: flex;
          }

          .file-badge {
            font-size: var(--boxel-font-size-2xs);
            padding: 3px 8px;
          }
        }

        /* ── Large vertical card: tall + wide ───────────────────────── */
        /* Only upgrade font sizes when there's enough width to fit them */
        @container fitted-card (aspect-ratio <= 1.0) and (275px <= height) and (200px <= width) {
          .title {
            font: 700 var(--boxel-font-lg);
          }

          .meta-value {
            font-size: var(--boxel-font-size-xs);
          }

          .file-badge {
            font-size: var(--boxel-font-size-xs);
          }

          .file-item,
          .file-more {
            font-size: var(--boxel-font-size-xs);
          }
        }

        /* ── Horizontal strips (height <= 80px) ────────────────────── */
        /* Icon shrinks to fit height, title + listing go inline */
        @container fitted-card (1.0 < aspect-ratio) and (height <= 80px) {
          .submission-fitted {
            align-items: center;
            gap: var(--boxel-sp-xs);
          }

          .image-icon-section {
            width: 44px;
            height: 44px;
          }

          .info-section {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
            flex-wrap: nowrap;
          }

          .title {
            -webkit-line-clamp: 1;
            white-space: nowrap;
            flex-shrink: 0;
          }

          .footer {
            margin-top: 0;
            margin-left: auto;
            flex-shrink: 0;
          }
        }

        /* Tiny strip (height <= 55px): even smaller icon */
        @container fitted-card (1.0 < aspect-ratio) and (height <= 55px) {
          .image-icon-section {
            width: 32px;
            height: 32px;
          }

          .title {
            font-size: var(--boxel-font-size-xs);
          }
        }

        /* ── Medium horizontal strip (81px–169px tall) ─────────────── */
        /* Show branch + room on wide strips that have vertical breathing room */
        @container fitted-card (1.0 < aspect-ratio) and (81px <= height) and (height < 170px) {
          .branch-name,
          .room-id {
            display: flex;
          }
        }

        /* ── Large horizontal card (400px+ wide, 170px+ tall) ───────── */
        /*
         * Icon is a modest fixed square — content (title, listing, branch,
         * footer) gets the remaining width which is always the majority.
         */
        @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
          .submission-fitted {
            padding: var(--boxel-sp);
            gap: var(--boxel-sp-sm);
          }

          .image-icon-section {
            width: 88px;
            height: 88px;
          }

          .title {
            font: 700 var(--boxel-font-lg);
            -webkit-line-clamp: 3;
          }

          .branch-name,
          .room-id {
            display: flex;
          }

          .meta-value {
            font-size: var(--boxel-font-size-xs);
          }

          .file-badge {
            font-size: var(--boxel-font-size-xs);
            padding: 3px 8px;
          }
        }

        /* ── Horizontal badge (too narrow for icon) ─────────────────── */
        @container fitted-card (1.0 < aspect-ratio) and (width < 220px) {
          .image-icon-section {
            display: none;
          }

          .title {
            font-size: var(--boxel-font-size-xs);
            -webkit-line-clamp: 1;
          }

          .footer {
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

    get githubURL() {
      return this.args.model.githubURL;
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
              {{#if this.githubURL}}
                <a
                  class='github-link'
                  href={{this.githubURL}}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <BrandGithubIcon width='14' height='14' />View on GitHub
                </a>
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
              <BoxelButton
                @kind='secondary-dark'
                class='view-listing-btn'
                aria-label='View listing details'
                {{on 'click' this.openListing}}
              >
                View Listing
              </BoxelButton>
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
          background: var(--boxel-light);
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

        /* Actions (file count + GitHub link) */
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

        .github-link {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-sm);
          padding: 4px 10px;
          color: rgba(255, 255, 255, 0.7);
          text-decoration: none;
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: var(--boxel-border-radius-sm);
          transition:
            color 0.15s,
            border-color 0.15s;
          white-space: nowrap;
        }

        .github-link:hover {
          color: #fff;
          border-color: rgba(255, 255, 255, 0.6);
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

        /* Always-visible "View Listing" button, centered in image panel */
        .view-listing-btn {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          --boxel-button-font: 600 var(--boxel-font-sm);
          --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          --boxel-button-color: var(--boxel-purple);
          --boxel-button-border: 1px solid var(--boxel-light);
          --boxel-button-text-color: var(--boxel-light);
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
          color: var(--boxel-400);
        }

        .section-icon {
          color: var(--boxel-400);
        }

        .section-count {
          margin-left: var(--boxel-sp-4xs);
          padding: 1px 6px;
          background: var(--boxel-300);
          color: var(--boxel-600);
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

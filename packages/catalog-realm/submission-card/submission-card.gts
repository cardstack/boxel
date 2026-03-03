import {
  CardDef,
  FieldDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BotIcon from '@cardstack/boxel-icons/bot';
import BrandGithubIcon from '@cardstack/boxel-icons/brand-github';
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
}

function isPlural(count: number): boolean {
  return count !== 1;
}

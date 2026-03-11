import { on } from '@ember/modifier';

import { Component, realmURL } from 'https://cardstack.com/base/card-api';
import type { Query } from '@cardstack/runtime-common';

import { or } from '@cardstack/boxel-ui/helpers';
import { BoxelButton } from '@cardstack/boxel-ui/components';

import FileCodeIcon from '@cardstack/boxel-icons/file-code';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import MessageIcon from '@cardstack/boxel-icons/message';
import GitBranchIcon from '@cardstack/boxel-icons/git-branch';

import { buildRealmHrefs } from '../../../pr-card/utils';
import type { SubmissionCard } from '../../submission-card';

export class IsolatedTemplate extends Component<typeof SubmissionCard> {
  get fileCount() {
    return this.args.model.allFileContents?.length ?? 0;
  }

  get listingName() {
    return this.args.model.listing?.name ?? this.args.model.listing?.cardTitle;
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

  get realmHrefs() {
    return buildRealmHrefs(this.args.model[realmURL]?.href);
  }

  get prCardQuery(): Query | undefined {
    if (!this.args.model.branchName) return undefined;
    return {
      filter: {
        on: {
          module: new URL('../../../pr-card/pr-card', import.meta.url).href,
          name: 'PrCard',
        },
        eq: { branchName: this.args.model.branchName },
      },
      sort: [{ by: 'lastModified', direction: 'desc' }],
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
      .submission-isolated {
        container-type: inline-size;
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
        background: var(--card, #ffffff);
      }

      .submission-hero {
        display: grid;
        grid-template-columns: 1fr 320px;
        min-height: 260px;
        background: #1e293b;
        flex-shrink: 0;
      }

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
}

function isPlural(count: number): boolean {
  return count !== 1;
}

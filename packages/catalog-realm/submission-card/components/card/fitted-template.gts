import { on } from '@ember/modifier';

import { Component } from 'https://cardstack.com/base/card-api';

import { BoxelButton } from '@cardstack/boxel-ui/components';

import GitBranchIcon from '@cardstack/boxel-icons/git-branch';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import MessageIcon from '@cardstack/boxel-icons/message';

import type { SubmissionCard } from '../../submission-card';

export class FittedTemplate extends Component<typeof SubmissionCard> {
  get listingName() {
    return this.args.model.listing?.name ?? this.args.model.listing?.cardTitle;
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

  openPrCard = (e: Event) => {
    e.stopPropagation();
    if (this.args.model.prCard) {
      this.args.viewCard?.(this.args.model.prCard, 'isolated');
    }
  };

  openSubmission = (e: Event) => {
    e.stopPropagation();
    if (this.args.model.id) {
      this.args.viewCard?.(this.args.model as SubmissionCard, 'isolated');
    }
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
          <span class='title'>{{@model.cardTitle}}</span>
          {{#if @model.branchName}}
            <span class='branch-name'>
              <span class='meta-label'>
                <GitBranchIcon class='meta-icon' width='10' height='10' />Branch
              </span>
              <span class='meta-value'>{{@model.branchName}}</span>
            </span>
          {{/if}}
          {{#if @model.roomId}}
            <span class='room-id'>
              <span class='meta-label'>
                <MessageIcon class='meta-icon' width='10' height='10' />Room
              </span>
              <span class='meta-value'>{{@model.roomId}}</span>
            </span>
          {{/if}}
        </button>
        <footer class='footer'>
          {{#if @model.prCard}}
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

      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width) and (170px <= height) {
        .title {
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 3;
        }
      }

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

      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width) and (275px <= height) {
        .title {
          -webkit-line-clamp: 1;
        }

        .meta-value {
          font-size: var(--boxel-font-size-xs);
        }
      }

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

      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (80px <= height) {
        .branch-name,
        .room-id {
          display: flex;
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

      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
        .image-icon-section {
          display: none;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
        .title {
          -webkit-line-clamp: 1;
          font: 600 var(--boxel-font-xs);
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
        .title {
          -webkit-line-clamp: 3;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
        .submission-fitted {
          padding: var(--boxel-sp-xxxs);
        }

        .branch-name,
        .room-id {
          display: none;
        }
      }

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

      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
        .title {
          font-size: var(--boxel-font-size-md);
        }

        .info-section {
          padding: var(--boxel-sp);
        }
      }

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
}

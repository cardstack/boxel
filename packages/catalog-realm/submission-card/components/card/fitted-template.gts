import { Component } from 'https://cardstack.com/base/card-api';

import GitBranchIcon from '@cardstack/boxel-icons/git-branch';
import MessageIcon from '@cardstack/boxel-icons/message';

import type { SubmissionCard } from '../../submission-card';

export class FittedTemplate extends Component<typeof SubmissionCard> {
  get listingName() {
    return this.args.model.listing?.name ?? this.args.model.listing?.cardTitle;
  }

  get listingImage() {
    return this.args.model.listing?.images?.[0];
  }

  get submittedAt() {
    return this.args.model.prCard?.submittedAt;
  }

  get submittedAtText() {
    if (!this.submittedAt) {
      return null;
    }

    let submittedAt = new Date(this.submittedAt);
    if (Number.isNaN(submittedAt.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(submittedAt);
  }

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
      </header>
      <section class='info-section'>
        <div class='info-main'>
          <div class='title-row'>
            <h3 class='title'>{{@model.cardTitle}}</h3>
          </div>

          {{#if @model.branchName}}
            <p class='branch-name'>
              <span class='meta-label'>
                <GitBranchIcon class='meta-icon' width='10' height='10' />Branch
              </span>
              <span class='meta-value'>{{@model.branchName}}</span>
            </p>
          {{/if}}

          {{#if @model.roomId}}
            <p class='room-id'>
              <span class='meta-label'>
                <MessageIcon class='meta-icon' width='10' height='10' />Room
              </span>
              <span class='meta-value'>{{@model.roomId}}</span>
            </p>
          {{/if}}
        </div>
        {{#if this.submittedAtText}}
          <footer class='info-footer'>
            <span class='submitted-at'>Submitted •
              {{this.submittedAtText}}</span>
          </footer>
        {{/if}}
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
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 2px 12px rgba(15, 23, 42, 0.05);
      }

      .image-icon-section {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        width: 60px;
        height: 60px;
        align-self: center;
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

      .info-main {
        width: 100%;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }

      .info-footer {
        margin-top: auto;
        width: 100%;
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid var(--border, var(--boxel-border-color));
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        width: 100%;
        min-width: 0;
      }

      .title {
        margin: 0;
        flex: 1;
        min-width: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
        line-height: 1.3;
        text-align: left;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        color: var(--foreground, #1f2328);
      }

      .pr-number {
        flex-shrink: 0;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, var(--boxel-border-color));
        font-size: var(--boxel-font-size-2xs);
        font-weight: 600;
        font-family: var(--boxel-font-family);
        color: var(--muted-foreground, #656d76);
        white-space: nowrap;
      }

      .branch-name,
      .room-id {
        display: none;
        margin: 0;
        width: 100%;
        min-width: 0;
        align-items: end;
        gap: var(--boxel-sp-5xs);
      }

      .meta-label {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        font-family: var(--boxel-font-family);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
        color: var(--muted-foreground, #656d76);
      }

      .meta-icon {
        flex-shrink: 0;
        color: var(--muted-foreground, #656d76);
      }

      .meta-value {
        min-width: 0;
        font-size: var(--boxel-font-size-2xs);
        font-weight: 500;
        font-family: var(--boxel-monospace-font-family);
        color: var(--muted-foreground, #656d76);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .submitted-at {
        display: block;
        font-size: var(--boxel-font-size-2xs);
        font-weight: 500;
        color: var(--muted-foreground, #656d76);
      }

      @container fitted-card (aspect-ratio <= 1.0) {
        .submission-fitted {
          flex-direction: column;
        }

        .image-icon-section {
          width: 100%;
          height: 46cqmin;
          align-self: auto;
        }

        .info-section {
          align-items: flex-start;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 190px) {
        .image-icon-section {
          height: 38cqmin;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 140px) {
        .info-footer {
          display: none;
        }

        .title {
          -webkit-line-clamp: 1;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 80px) {
        .image-icon-section {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (275px <= height) {
        .image-icon-section {
          height: 55cqmin;
        }

        .branch-name,
        .room-id {
          display: flex;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (275px <= height) and (200px <= width) {
        .title {
          font: 700 var(--boxel-font-lg);
          -webkit-line-clamp: 3;
        }

        .meta-value {
          font-size: var(--boxel-font-size-xs);
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (height <= 80px) {
        .submission-fitted {
          align-items: center;
        }

        .image-icon-section {
          width: 44px;
          height: 44px;
        }

        .info-section {
          flex-direction: row;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }

        .info-main {
          min-width: 0;
        }

        .info-footer {
          margin-top: 0;
          margin-left: auto;
          padding-top: 0;
          border-top: none;
          flex-shrink: 0;
        }

        .title {
          -webkit-line-clamp: 1;
        }

        .branch-name,
        .room-id {
          display: none;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (height <= 55px) {
        .image-icon-section {
          width: 32px;
          height: 32px;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (width < 220px) {
        .image-icon-section,
        .info-footer {
          display: none;
        }

        .title {
          -webkit-line-clamp: 1;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (81px <= height) and (height < 170px) {
        .branch-name,
        .room-id {
          display: flex;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
        .submission-fitted {
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
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
      }
    </style>
  </template>
}

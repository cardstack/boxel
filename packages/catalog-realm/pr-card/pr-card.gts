import {
  CardDef,
  Component,
  StringField,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Listing } from '../catalog-app/listing/listing';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import GitPullRequestClosedIcon from '@cardstack/boxel-icons/git-pull-request-closed';
import GitPullRequestDraftIcon from '@cardstack/boxel-icons/git-pull-request-draft';
import GitMergeIcon from '@cardstack/boxel-icons/git-merge';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import { Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

// ── Mock data (state only — title/number/url/provenance come from @model) ──
const MOCK_STATE: {
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
} = {
  state: 'open',
  draft: false,
  merged: false,
};

// Latest CI run — single overall status event
const MOCK_CI: { status: 'success' | 'failure' | 'in_progress' } = {
  status: 'in_progress',
};

type MockReview = {
  reviewer: string;
  state: 'approved' | 'changes_requested';
  comment: string;
};

// Review: state, reviewer, comment only
const MOCK_REVIEWS: MockReview[] = [
  {
    reviewer: 'tintinthong',
    state: 'changes_requested',
    comment:
      "The token-refresh logic in `authenticate()` doesn't handle concurrent " +
      'requests – if two calls race, both may try to refresh and one will fail. ' +
      'Please add a mutex / single-flight guard before merging.',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function prStateLabel(s: typeof MOCK_STATE) {
  if (s.merged) return 'Merged';
  if (s.draft) return 'Draft';
  if (s.state === 'closed') return 'Closed';
  return 'Open';
}

// Colors match github-pr-brand-guide.json rootVariables:
function stateColor(label: string) {
  switch (label) {
    case 'Merged':
      return '#8957e5';
    case 'Closed':
      return '#cf222e';
    case 'Draft':
      return '#6e7681';
    default:
      return '#238636';
  }
}

class IsolatedTemplate extends Component<typeof PrCard> {
  get mockCi() {
    return MOCK_CI;
  }
  get mockReviews() {
    return MOCK_REVIEWS;
  }

  get stateLabel() {
    return prStateLabel(MOCK_STATE);
  }
  get pillColor() {
    return stateColor(this.stateLabel);
  }

  get prTitle() {
    return this.args.model.prTitle ?? 'Pull Request';
  }

  get prUrl() {
    return this.args.model.prUrl ?? '#';
  }

  get changesRequestedCount() {
    return this.mockReviews.filter((r) => r.state === 'changes_requested')
      .length;
  }

  get latestChangesRequestedReview() {
    let changesRequestedReviews = this.mockReviews.filter(
      (r) => r.state === 'changes_requested',
    );
    return changesRequestedReviews[changesRequestedReviews.length - 1] ?? null;
  }

  get latestChangesRequestedComment() {
    let comment = this.latestChangesRequestedReview?.comment?.trim();
    return comment || '-';
  }

  get overallReviewState() {
    if (this.mockReviews.some((r) => r.state === 'changes_requested'))
      return 'changes_requested';
    if (
      this.mockReviews.length &&
      this.mockReviews.every((r) => r.state === 'approved')
    )
      return 'approved';
    return null;
  }

  <template>
    <article class='pr-card'>
      {{! ── Dark hero — always GitHub dark canvas ── }}
      <div class='pr-hero'>
        <h1 class='pr-title'>
          {{this.prTitle}}
          {{#if @model.prNumber}}
            <span class='pr-number'>#{{@model.prNumber}}</span>
          {{/if}}
        </h1>
        <div class='pr-meta-row'>
          <Pill class='pr-state-pill' @pillBackgroundColor={{this.pillColor}}>
            <:iconLeft>
              {{#if (eq this.stateLabel 'Merged')}}
                <GitMergeIcon class='pr-pill-icon' />
              {{else if (eq this.stateLabel 'Closed')}}
                <GitPullRequestClosedIcon class='pr-pill-icon' />
              {{else if (eq this.stateLabel 'Draft')}}
                <GitPullRequestDraftIcon class='pr-pill-icon' />
              {{else}}
                <GitPullRequestIcon class='pr-pill-icon' />
              {{/if}}
            </:iconLeft>
            <:default>
              <span class='pr-state-label'>{{this.stateLabel}}</span>
            </:default>
          </Pill>

          {{#if @model.submittedBy}}
            <span class='pr-meta-text'>
              <strong class='pr-meta-author'>{{@model.submittedBy}}</strong>
            </span>
          {{/if}}

          {{#if @model.submittedAt}}
            <span class='pr-meta-sep'>·</span>
            <span class='pr-meta-text'><@fields.submittedAt /></span>
          {{/if}}

          <a
            href={{this.prUrl}}
            target='_blank'
            rel='noopener noreferrer'
            class='pr-external-link'
            title='Open PR on GitHub'
          >
            <ExternalLinkIcon class='pr-external-icon' />
          </a>
        </div>
      </div>

      {{! ── White body ── }}
      <div class='pr-body'>
        {{! ── 2-column: CI Checks + Reviews ── }}
        <section class='pr-status-section'>
          {{! ── Left: CI Checks ── }}
          <div class='status-col'>
            <div class='col-header'>
              <label class='header-label'>CI Checks</label>
              {{#if (eq this.mockCi.status 'in_progress')}}
                <span class='ci-overall-badge ci-overall-badge--pending'>In
                  Progress</span>
              {{else if (eq this.mockCi.status 'failure')}}
                <span
                  class='ci-overall-badge ci-overall-badge--failure'
                >Failed</span>
              {{else}}
                <span
                  class='ci-overall-badge ci-overall-badge--success'
                >Passed</span>
              {{/if}}
            </div>

            <div class='ci-status-row'>
              {{#if (eq this.mockCi.status 'success')}}
                <span class='ci-dot ci-dot--success' aria-label='passed'></span>
                <span class='ci-status-label ci-status-label--success'>
                  All checks passed
                </span>
              {{else if (eq this.mockCi.status 'failure')}}
                <span class='ci-dot ci-dot--failure' aria-label='failed'></span>
                <span class='ci-status-label ci-status-label--failure'>
                  Check run failed
                </span>
              {{else}}
                <span class='ci-dot ci-dot--pending' aria-label='in progress'>
                  <span class='ci-dot-inner'></span>
                </span>
                <span class='ci-status-label ci-status-label--pending'>
                  Checks running…
                </span>
              {{/if}}
            </div>
          </div>

          <div class='status-divider'></div>

          {{! ── Right: Reviews ── }}
          <div class='status-col'>
            <div class='col-header'>
              <label class='header-label'>Reviews</label>
              {{#if (eq this.overallReviewState 'changes_requested')}}
                <span class='review-state-badge review-state-badge--changes'>
                  Changes Requested
                </span>
              {{else if (eq this.overallReviewState 'approved')}}
                <span class='review-state-badge review-state-badge--approved'>
                  Approved
                </span>
              {{/if}}
            </div>

            {{#if this.latestChangesRequestedReview}}
              <ul class='review-list'>
                <li class='review-item'>
                  <div class='review-top-row'>
                    <span class='reviewer-name'>
                      {{this.latestChangesRequestedReview.reviewer}}
                    </span>
                    <a
                      href={{this.prUrl}}
                      target='_blank'
                      rel='noopener noreferrer'
                      class='review-external-link'
                      title='View review on GitHub'
                    >
                      <ExternalLinkIcon class='review-external-icon' />
                    </a>
                  </div>

                  <blockquote class='review-comment'>
                    {{this.latestChangesRequestedComment}}
                  </blockquote>
                </li>
              </ul>
            {{else}}
              -
            {{/if}}
          </div>

        </section>

        {{! ── Listing ── }}
        {{#if @model.listing}}
          <section class='pr-listing-section'>
            <div class='listing-section-label'>
              <label class='header-label'>View Listing</label>
            </div>
            <div class='pr-listing-embedded'>
              <@fields.listing @format='embedded' />
            </div>
          </section>
        {{/if}}
      </div>
    </article>

    <style scoped>
      .pr-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      /* ── Dark hero ── */
      .pr-hero {
        background: #0d1117;
        color: #e6edf3;
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        flex-shrink: 0;
        border-bottom: 1px solid #30363d;
      }
      .pr-title {
        font-size: 1.4rem;
        font-weight: 600;
        margin: 0;
        line-height: 1.3;
        color: #e6edf3;
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .pr-number {
        font-size: 1.2rem;
        font-weight: 600;
        color: #8b949e;
      }
      .pr-meta-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      /* pill border-radius via CSS var — avoids overwriting @pillBackgroundColor */
      .pr-state-pill {
        --boxel-pill-border-radius: 2em;
      }

      .pr-pill-icon {
        width: 14px;
        height: 14px;
        color: #fff;
        flex-shrink: 0;
      }
      .pr-state-label {
        font-size: var(--boxel-font-xs);
        font-weight: 600;
        color: #fff;
      }
      .pr-meta-text {
        font-size: var(--boxel-font-xs);
        color: #8b949e;
      }
      .pr-meta-author {
        color: #e6edf3;
        font-weight: 600;
      }
      .pr-meta-sep {
        color: #484f58;
        font-size: var(--boxel-font-xs);
      }
      .pr-external-link {
        margin-left: auto;
        color: #8b949e;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: color 0.15s ease;
      }
      .pr-external-link:hover {
        color: #58a6ff;
      }
      .pr-external-icon {
        width: 14px;
        height: 14px;
      }

      /* ── Body ── */
      .pr-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--card, #ffffff);
        color: var(--card-foreground, #24292f);
        overflow-y: auto;
      }

      /* ── Listing section ── */
      .pr-listing-section {
        padding: var(--boxel-sp) var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .listing-section-label {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);

        font-size: var(--boxel-font-xs);
        font-weight: 600;
        color: var(--muted-foreground, #57606a);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .listing-label-icon {
        width: 11px;
        height: 11px;
        color: var(--muted-foreground, #57606a);
      }
      .pr-listing-embedded {
        border: 2px solid var(--border, #d0d7de);
        border-radius: var(--radius, 0.375rem);
        overflow: hidden;
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease;
        cursor: pointer;
      }
      .pr-listing-embedded:hover {
        border-color: var(--primary, #0969da);
        box-shadow: 0 0 0 3px
          color-mix(in srgb, var(--primary, #0969da) 15%, transparent);
      }

      /* ── 2-column status section ── */
      .pr-status-section {
        display: flex;
        flex-wrap: wrap;
      }
      .status-col {
        flex: 1;
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        overflow-y: auto;
      }
      .status-divider {
        width: 1px;
        background: var(--border, #d0d7de);
        flex-shrink: 0;
        margin: var(--boxel-sp-lg) 0;
      }

      /* ── Column headers ── */
      .col-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .header-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--foreground, #24292f);
      }

      /* CI overall badge */
      .ci-overall-badge {
        font-size: 11px;
        font-weight: 600;
        border-radius: 2em;
        padding: 1px 8px;
      }
      .ci-overall-badge--pending {
        background: color-mix(
          in srgb,
          var(--chart-4, #9a6700) 12%,
          var(--card, #ffffff)
        );
        color: var(--chart-4, #9a6700);
        border: 1px solid
          color-mix(in srgb, var(--chart-4, #9a6700) 40%, var(--card, #ffffff));
      }
      .ci-overall-badge--failure {
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 10%,
          var(--card, #ffffff)
        );
        color: var(--destructive, #cf222e);
        border: 1px solid
          color-mix(
            in srgb,
            var(--destructive, #cf222e) 30%,
            var(--card, #ffffff)
          );
      }
      .ci-overall-badge--success {
        background: color-mix(
          in srgb,
          var(--chart-1, #238636) 10%,
          var(--card, #ffffff)
        );
        color: var(--chart-1, #238636);
        border: 1px solid
          color-mix(in srgb, var(--chart-1, #238636) 35%, var(--card, #ffffff));
      }

      /* ── Single CI status row ── */
      .ci-status-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, #d0d7de);
        border-radius: var(--radius, 0.375rem);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .ci-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ci-dot--success {
        background: var(--chart-1, #238636);
        position: relative;
      }
      .ci-dot--success::after {
        content: '';
        display: block;
        width: 6px;
        height: 3px;
        border-left: 1.5px solid #fff;
        border-bottom: 1.5px solid #fff;
        transform: rotate(-45deg) translateY(-1px);
      }
      .ci-dot--failure {
        background: var(--destructive, #cf222e);
        position: relative;
      }
      .ci-dot--failure::after {
        content: '';
        display: block;
        width: 6px;
        height: 6px;
        background:
          linear-gradient(
              45deg,
              transparent 30%,
              #fff 30%,
              #fff 70%,
              transparent 70%
            )
            no-repeat center / 100% 1.5px,
          linear-gradient(
              -45deg,
              transparent 30%,
              #fff 30%,
              #fff 70%,
              transparent 70%
            )
            no-repeat center / 100% 1.5px;
      }
      .ci-dot--pending {
        border: 2px solid var(--chart-4, #9a6700);
        background: transparent;
        animation: ci-spin 1s linear infinite;
      }
      .ci-dot-inner {
        display: block;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--chart-4, #9a6700);
      }
      @keyframes ci-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      .ci-status-label {
        font-size: var(--boxel-font-sm);
        font-weight: 400;
        color: var(--card-foreground, #24292f);
      }

      /* ── Review list ── */
      .review-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .review-item {
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, #d0d7de);
        border-radius: var(--radius, 0.375rem);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .review-top-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .reviewer-name {
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        color: var(--foreground, #24292f);
      }
      .review-external-link {
        margin-left: auto;
        color: var(--muted-foreground, #57606a);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: color 0.15s ease;
        flex-shrink: 0;
      }
      .review-external-link:hover {
        color: var(--primary, #0969da);
      }
      .review-external-icon {
        width: 13px;
        height: 13px;
      }

      .review-state-badge {
        display: inline-flex;
        align-self: center;
        font-size: 11px;
        font-weight: 600;
        border-radius: 2em;
        padding: 2px 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
      }
      .review-state-badge--changes {
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 10%,
          var(--card, #ffffff)
        );
        color: var(--destructive, #cf222e);
        border: 1px solid
          color-mix(
            in srgb,
            var(--destructive, #cf222e) 30%,
            var(--card, #ffffff)
          );
      }
      .review-state-badge--approved {
        background: color-mix(
          in srgb,
          var(--chart-1, #238636) 10%,
          var(--card, #ffffff)
        );
        color: var(--chart-1, #238636);
        border: 1px solid
          color-mix(in srgb, var(--chart-1, #238636) 35%, var(--card, #ffffff));
      }

      .review-comment {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-sm);
        color: var(--card-foreground, #24292f);
        border-left: 3px solid var(--border, #d0d7de);
        font-style: normal;
        line-height: 1.6;
        background: var(--card, #ffffff);
        border-radius: 0 var(--radius, 0.375rem) var(--radius, 0.375rem) 0;
        transition:
          border-left-color 0.15s ease,
          background 0.15s ease;
        cursor: default;
      }
      .review-comment:hover {
        border-left-color: var(--destructive, #cf222e);
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 5%,
          var(--card, #ffffff)
        );
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof PrCard> {
  get mockCi() {
    return MOCK_CI;
  }
  get mockReviews() {
    return MOCK_REVIEWS;
  }
  get stateLabel() {
    return prStateLabel(MOCK_STATE);
  }
  get pillColor() {
    return stateColor(this.stateLabel);
  }

  get prTitle() {
    return this.args.model.prTitle ?? 'Pull Request';
  }
  get prUrl() {
    return this.args.model.prUrl ?? '#';
  }

  get changesRequestedCount() {
    return this.mockReviews.filter((r) => r.state === 'changes_requested')
      .length;
  }

  get latestChangesRequestedReview() {
    let changesRequestedReviews = this.mockReviews.filter(
      (r) => r.state === 'changes_requested',
    );
    return changesRequestedReviews[changesRequestedReviews.length - 1] ?? null;
  }

  get latestChangesRequestedComment() {
    let comment = this.latestChangesRequestedReview?.comment?.trim();
    return comment || '-';
  }

  get overallReviewState() {
    if (this.mockReviews.some((r) => r.state === 'changes_requested'))
      return 'changes_requested';
    if (
      this.mockReviews.length &&
      this.mockReviews.every((r) => r.state === 'approved')
    )
      return 'approved';
    return null;
  }

  <template>
    <article class='pr-card'>
      {{! ── Top: dark hero — title, number, pill, author ── }}
      <div class='pr-hero'>
        <div class='fit-title-row'>
          <p class='pr-title'>
            {{this.prTitle}}
            {{#if @model.prNumber}}
              <span class='pr-number'>#{{@model.prNumber}}</span>
            {{/if}}
          </p>
          <a
            href={{this.prUrl}}
            target='_blank'
            rel='noopener noreferrer'
            class='pr-external-link'
            title='Open PR on GitHub'
          >
            <ExternalLinkIcon class='pr-external-icon' />
          </a>
        </div>

        <div class='pr-meta-row'>
          <Pill class='pr-state-pill' @pillBackgroundColor={{this.pillColor}}>
            <:iconLeft>
              {{#if (eq this.stateLabel 'Merged')}}
                <GitMergeIcon class='pr-pill-icon' />
              {{else if (eq this.stateLabel 'Closed')}}
                <GitPullRequestClosedIcon class='pr-pill-icon' />
              {{else if (eq this.stateLabel 'Draft')}}
                <GitPullRequestDraftIcon class='pr-pill-icon' />
              {{else}}
                <GitPullRequestIcon class='pr-pill-icon' />
              {{/if}}
            </:iconLeft>
            <:default>
              <span class='pr-state-label'>{{this.stateLabel}}</span>
            </:default>
          </Pill>

          {{#if @model.submittedBy}}
            <span class='pr-meta-sep'>·</span>
            <span class='pr-meta-author'>{{@model.submittedBy}}</span>
          {{/if}}
        </div>
      </div>

      {{! ── Light body — pills, shown at medium sizes ── }}
      <div class='pr-body'>
        {{#if (eq this.mockCi.status 'in_progress')}}
          <span class='fit-status-pill fit-ci-pill--pending'>CI In Progress</span>
        {{else if (eq this.mockCi.status 'failure')}}
          <span class='fit-status-pill fit-ci-pill--failure'>CI Failed</span>
        {{else}}
          <span class='fit-status-pill fit-ci-pill--success'>CI Passed</span>
        {{/if}}

        {{#if this.changesRequestedCount}}
          <span class='fit-status-pill fit-review-pill'>
            {{this.changesRequestedCount}}
            Changes Requested
          </span>
        {{/if}}
      </div>

      {{! ── Detailed body — large sizes: CI top, reviews bottom ── }}
      <div class='fit-detail'>

        {{! CI column }}
        <div class='status-col'>
          <div class='col-header'>
            <label class='header-label'>CI Checks</label>
            {{#if (eq this.mockCi.status 'in_progress')}}
              <span class='ci-overall-badge ci-overall-badge--pending'>In
                Progress</span>
            {{else if (eq this.mockCi.status 'failure')}}
              <span
                class='ci-overall-badge ci-overall-badge--failure'
              >Failed</span>
            {{else}}
              <span
                class='ci-overall-badge ci-overall-badge--success'
              >Passed</span>
            {{/if}}
          </div>
          <div class='ci-status-row'>
            {{#if (eq this.mockCi.status 'success')}}
              <span class='ci-dot ci-dot--success' aria-label='passed'></span>
              <span class='ci-status-label ci-status-label--success'>
                All checks passed
              </span>
            {{else if (eq this.mockCi.status 'failure')}}
              <span class='ci-dot ci-dot--failure' aria-label='failed'></span>
              <span class='ci-status-label ci-status-label--failure'>
                Check run failed
              </span>
            {{else}}
              <span class='ci-dot ci-dot--pending' aria-label='in progress'>
                <span class='ci-dot-inner'></span>
              </span>
              <span class='ci-status-label ci-status-label--pending'>
                Checks running…
              </span>
            {{/if}}
          </div>
        </div>

        {{! Reviews column }}
        {{#if this.mockReviews.length}}
          <div class='status-col'>
            <div class='col-header'>
              <label class='header-label'>Reviews</label>
              {{#if (eq this.overallReviewState 'changes_requested')}}
                <span class='review-state-badge review-state-badge--changes'>
                  Changes Requested
                </span>
              {{else if (eq this.overallReviewState 'approved')}}
                <span class='review-state-badge review-state-badge--approved'>
                  Approved
                </span>
              {{/if}}
            </div>
            {{#if this.latestChangesRequestedReview}}
              <ul class='review-list'>
                <li class='review-item'>
                  <div class='review-top-row'>
                    <span class='reviewer-name'>
                      {{this.latestChangesRequestedReview.reviewer}}
                    </span>
                    <a
                      href={{this.prUrl}}
                      target='_blank'
                      rel='noopener noreferrer'
                      class='review-external-link'
                      title='View review on GitHub'
                    >
                      <ExternalLinkIcon class='review-external-icon' />
                    </a>
                  </div>
                  <blockquote class='review-comment'>
                    {{this.latestChangesRequestedComment}}
                  </blockquote>
                </li>
              </ul>
            {{else}}
              -
            {{/if}}
          </div>
        {{/if}}
      </div>
    </article>

    <style scoped>
      /* ── Shell ── */
      .pr-card {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      /* ── Hero ── */
      .pr-hero {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--background, #0d1117);
        color: var(--foreground, #e6edf3);
        border-bottom: 1px solid var(--border, #30363d);
      }

      /* Fitted-only: title + external link on same row */
      .fit-title-row {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }

      .pr-title {
        margin: 0;
        font-size: var(--boxel-font-sm);
        font-weight: 600;
        color: var(--foreground, #e6edf3);
        line-height: 1.3;
        flex: 1;
        min-width: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .pr-number {
        font-size: 0.85em;
        font-weight: 600;
        color: var(--muted-foreground, #8b949e);
        white-space: nowrap;
      }

      .pr-external-link {
        color: var(--muted-foreground, #8b949e);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        transition: color 0.12s ease;
        padding-top: 2px;
      }
      .pr-external-link:hover {
        color: var(--primary, #58a6ff);
      }
      .pr-external-icon {
        width: 12px;
        height: 12px;
      }

      .pr-meta-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
        min-width: 0;
      }

      .pr-state-pill {
        flex-shrink: 0;
        --boxel-pill-border-radius: 2em;
      }
      .pr-pill-icon {
        width: 11px;
        height: 11px;
        color: #fff;
      }
      .pr-state-label {
        font-size: 10px;
        font-weight: 600;
        color: #fff;
      }

      .pr-meta-sep {
        color: var(--muted-foreground, #484f58);
        font-size: var(--boxel-font-xs);
      }
      .pr-meta-author {
        font-size: var(--boxel-font-xs);
        color: var(--muted-foreground, #8b949e);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }

      /* ── Light body — status pills (medium sizes) ── */
      .pr-body {
        flex: 1;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card, #ffffff);
        overflow: hidden;
        flex-wrap: wrap;
      }

      /* Fitted-only: summary status pills */
      .fit-status-pill {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        border-radius: 2em;
        padding: 3px 10px;
        white-space: nowrap;
      }
      .fit-ci-pill--pending {
        background: color-mix(
          in srgb,
          var(--chart-4, #9a6700) 12%,
          var(--card, #ffffff)
        );
        color: var(--chart-4, #9a6700);
        border: 1px solid
          color-mix(in srgb, var(--chart-4, #9a6700) 40%, var(--card, #ffffff));
      }
      .fit-ci-pill--failure {
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 10%,
          var(--card, #ffffff)
        );
        color: var(--destructive, #cf222e);
        border: 1px solid
          color-mix(
            in srgb,
            var(--destructive, #cf222e) 30%,
            var(--card, #ffffff)
          );
      }
      .fit-ci-pill--success {
        background: color-mix(
          in srgb,
          var(--chart-1, #238636) 10%,
          var(--card, #ffffff)
        );
        color: var(--chart-1, #238636);
        border: 1px solid
          color-mix(in srgb, var(--chart-1, #238636) 35%, var(--card, #ffffff));
      }
      .fit-review-pill {
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 10%,
          var(--card, #ffffff)
        );
        color: var(--destructive, #cf222e);
        border: 1px solid
          color-mix(
            in srgb,
            var(--destructive, #cf222e) 30%,
            var(--card, #ffffff)
          );
      }

      /* ═══════════════════════════════════════════════════════
         CONTAINER QUERIES
         ═══════════════════════════════════════════════════════ */

      /* Short: hide body, hero fills card */
      @container fitted-card (height <= 80px) {
        .pr-body {
          display: none;
        }
        .pr-hero {
          flex: 1;
          justify-content: center;
          border-bottom: none;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .pr-title {
          -webkit-line-clamp: 1;
          font-size: var(--boxel-font-xs);
        }
        .pr-meta-author {
          display: none;
        }
        .pr-meta-sep {
          display: none;
        }
      }

      /* Very short: flatten hero to one row */
      @container fitted-card (height <= 55px) {
        .pr-hero {
          flex-direction: row;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .fit-title-row {
          flex: 1;
          min-width: 0;
          align-items: center;
        }
        .pr-meta-row {
          flex-shrink: 0;
          flex-wrap: nowrap;
        }
      }

      /* Tiny: just title */
      @container fitted-card (height <= 40px) {
        .pr-meta-row {
          display: none;
        }
      }

      /* Narrow: hide secondary text */
      @container fitted-card (width < 220px) {
        .pr-meta-author {
          display: none;
        }
        .pr-meta-sep {
          display: none;
        }
      }

      @container fitted-card (width < 150px) {
        .pr-body {
          display: none;
        }
      }

      /* Extra tiny: very narrow strip (<100px) — hide number, clamp to 1 line */
      @container fitted-card (width < 100px) {
        .pr-number {
          display: none;
        }
        .pr-title {
          -webkit-line-clamp: 1;
          font-size: 10px;
        }
      }

      /* Wide + short banner: ≥300px wide, 80–120px tall
         Landscape ratio — switch hero to a single horizontal row */
      @container fitted-card (300px <= width) and (80px < height) and (height <= 120px) {
        .pr-body {
          display: none;
        }
        .pr-hero {
          flex: 1;
          flex-direction: row;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-bottom: none;
        }
        .fit-title-row {
          flex: 1;
          min-width: 0;
          align-items: center;
        }
        .pr-meta-row {
          flex-shrink: 0;
          flex-wrap: nowrap;
        }
      }

      /* Medium-wide tile: ≥300px wide, 120–200px tall
         Extra breathing room before the large-font breakpoint kicks in */
      @container fitted-card (300px <= width) and (120px <= height) and (height < 200px) {
        .pr-hero {
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .pr-title {
          font-size: 1rem;
        }
        .pr-body {
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .fit-status-pill {
          font-size: var(--boxel-font-xs);
        }
      }

      /* Large: bigger hero fonts and icons */
      @container fitted-card (400px <= width) and (200px <= height) {
        .pr-hero {
          padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
          gap: var(--boxel-sp-xs);
        }
        .pr-title {
          font-size: 1.25rem;
          -webkit-line-clamp: 3;
        }
        .pr-external-icon {
          width: 18px;
          height: 18px;
        }
        .pr-pill-icon {
          width: 15px;
          height: 15px;
        }
        .pr-state-label {
          font-size: var(--boxel-font-sm);
        }
        .pr-meta-author {
          font-size: var(--boxel-font-sm);
          max-width: 200px;
        }
        .pr-body {
          padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          gap: var(--boxel-sp-sm);
        }
        .fit-status-pill {
          font-size: var(--boxel-font-xs);
          padding: 4px 12px;
        }
      }

      /* ── Detailed body — hidden by default, shown at large ── */
      .fit-detail {
        display: none;
        flex-direction: column;
        flex: 1;
        background: var(--card, #ffffff);
        overflow: hidden;
      }

      /* Columns — same pattern as isolated .status-col */
      .status-col {
        padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        flex-shrink: 0;
      }
      /* Reviews column grows to fill remaining space */
      .fit-detail .status-col:last-child {
        flex: 1;
        overflow: hidden;
      }

      .col-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .header-label {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--foreground, #24292f);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 1;
        min-width: 0;
      }

      /* CI overall badge */
      .ci-overall-badge {
        font-size: 12px;
        font-weight: 600;
        border-radius: 2em;
        padding: 1px 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
      }
      .ci-overall-badge--pending {
        background: color-mix(
          in srgb,
          var(--chart-4, #9a6700) 12%,
          var(--card, #ffffff)
        );
        color: var(--chart-4, #9a6700);
        border: 1px solid
          color-mix(in srgb, var(--chart-4, #9a6700) 40%, var(--card, #ffffff));
      }
      .ci-overall-badge--failure {
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 10%,
          var(--card, #ffffff)
        );
        color: var(--destructive, #cf222e);
        border: 1px solid
          color-mix(
            in srgb,
            var(--destructive, #cf222e) 30%,
            var(--card, #ffffff)
          );
      }
      .ci-overall-badge--success {
        background: color-mix(
          in srgb,
          var(--chart-1, #238636) 10%,
          var(--card, #ffffff)
        );
        color: var(--chart-1, #238636);
        border: 1px solid
          color-mix(in srgb, var(--chart-1, #238636) 35%, var(--card, #ffffff));
      }

      /* CI status row */
      .ci-status-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, #d0d7de);
        border-radius: var(--radius, 0.375rem);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .ci-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ci-dot--success {
        background: var(--chart-1, #238636);
        position: relative;
      }
      .ci-dot--success::after {
        content: '';
        display: block;
        width: 6px;
        height: 3px;
        border-left: 1.5px solid #fff;
        border-bottom: 1.5px solid #fff;
        transform: rotate(-45deg) translateY(-1px);
      }
      .ci-dot--failure {
        background: var(--destructive, #cf222e);
        position: relative;
      }
      .ci-dot--failure::after {
        content: '';
        display: block;
        width: 6px;
        height: 6px;
        background:
          linear-gradient(
              45deg,
              transparent 30%,
              #fff 30%,
              #fff 70%,
              transparent 70%
            )
            no-repeat center / 100% 1.5px,
          linear-gradient(
              -45deg,
              transparent 30%,
              #fff 30%,
              #fff 70%,
              transparent 70%
            )
            no-repeat center / 100% 1.5px;
      }
      .ci-dot--pending {
        border: 2px solid var(--chart-4, #9a6700);
        background: transparent;
        animation: ci-spin 1s linear infinite;
      }
      .ci-dot-inner {
        display: block;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--chart-4, #9a6700);
      }
      @keyframes ci-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      .ci-status-label {
        font-size: var(--boxel-font-sm);
        font-weight: 400;
        color: var(--card-foreground, #24292f);
      }

      /* Horizontal divider between CI and reviews */
      .status-divider {
        height: 1px;
        background: var(--border, #d0d7de);
        flex-shrink: 0;
        margin: 0 var(--boxel-sp-lg);
      }

      /* ── Review list ── */
      .review-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .review-item {
        background: var(--muted, #f6f8fa);
        border: 1px solid var(--border, #d0d7de);
        border-radius: var(--radius, 0.375rem);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .review-top-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .reviewer-name {
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        color: var(--foreground, #24292f);
      }
      .review-external-link {
        margin-left: auto;
        color: var(--muted-foreground, #57606a);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: color 0.15s ease;
        flex-shrink: 0;
      }
      .review-external-link:hover {
        color: var(--primary, #0969da);
      }
      .review-external-icon {
        width: 13px;
        height: 13px;
      }

      .review-state-badge {
        display: inline-flex;
        align-self: center;
        font-size: 11px;
        font-weight: 600;
        border-radius: 2em;
        padding: 2px 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
      }
      .review-state-badge--changes {
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 10%,
          var(--card, #ffffff)
        );
        color: var(--destructive, #cf222e);
        border: 1px solid
          color-mix(
            in srgb,
            var(--destructive, #cf222e) 30%,
            var(--card, #ffffff)
          );
      }
      .review-state-badge--approved {
        background: color-mix(
          in srgb,
          var(--chart-1, #238636) 10%,
          var(--card, #ffffff)
        );
        color: var(--chart-1, #238636);
        border: 1px solid
          color-mix(in srgb, var(--chart-1, #238636) 35%, var(--card, #ffffff));
      }

      .review-comment {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-sm);
        color: var(--card-foreground, #24292f);
        border-left: 3px solid var(--border, #d0d7de);
        font-style: normal;
        line-height: 1.6;
        background: var(--card, #ffffff);
        border-radius: 0 var(--radius, 0.375rem) var(--radius, 0.375rem) 0;
        transition:
          border-left-color 0.15s ease,
          background 0.15s ease;
        cursor: default;
      }
      .review-comment:hover {
        border-left-color: var(--destructive, #cf222e);
        background: color-mix(
          in srgb,
          var(--destructive, #cf222e) 5%,
          var(--card, #ffffff)
        );
      }

      /* Narrow tall tile: <300px wide but ≥200px tall
         Too much whitespace with just floating pills — show labeled
         stacked columns (CI Checks + Reviews) instead */
      @container fitted-card (width < 300px) and (200px <= height) {
        .pr-body {
          display: none;
        }
        .fit-detail {
          display: flex;
          flex-direction: column;
        }
        /* Tighter horizontal padding for narrow widths */
        .status-col {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .status-divider {
          margin: 0 var(--boxel-sp-sm);
        }
        /* Clamp review comment to 2 lines so it doesn't overflow */
        .review-comment {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
      }

      /* Switch to detailed layout at large sizes */
      @container fitted-card (400px <= width) and (240px <= height) {
        .pr-body {
          display: none;
        }
        .fit-detail {
          display: flex;
        }
      }

      /* Very wide cards: ≥500px wide, ≥200px tall — scale up fonts & padding */
      @container fitted-card (500px <= width) and (200px <= height) {
        .pr-hero {
          padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
        }
        .pr-title {
          font-size: 1.4rem;
          -webkit-line-clamp: 3;
        }
        .pr-external-icon {
          width: 20px;
          height: 20px;
        }
        .pr-meta-author {
          max-width: 280px;
        }
      }

      /* Extra-large tiles: ≥500px wide, ≥280px tall — bigger detail spacing */
      @container fitted-card (500px <= width) and (280px <= height) {
        .fit-detail .status-col {
          padding: var(--boxel-sp) var(--boxel-sp-xl);
        }
        .status-divider {
          margin: 0 var(--boxel-sp-xl);
        }
        .review-item {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .review-comment {
          font-size: var(--boxel-font-sm);
        }
      }
    </style>
  </template>
}

export class PrCard extends CardDef {
  static displayName = 'PR Card';
  static icon = GitPullRequestIcon;
  static headerColor = '#24292f';

  // === Links ===
  @field listing = linksTo(Listing);

  // === PR identity (set on the card instance) ===
  @field prNumber = contains(NumberField);
  @field prUrl = contains(StringField);
  @field prTitle = contains(StringField);

  // === Provenance (set on the card instance) ===
  @field submittedBy = contains(StringField);
  @field submittedAt = contains(DatetimeField);

  // === Computed ===
  @field cardTitle = contains(StringField, {
    computeVia(this: PrCard) {
      return this.prTitle ?? `PR #${this.prNumber}`;
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = IsolatedTemplate;
  static fitted = FittedTemplate;
}

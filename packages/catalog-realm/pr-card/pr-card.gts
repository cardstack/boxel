import {
  CardDef,
  Component,
  StringField,
  field,
  contains,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { Listing } from '../catalog-app/listing/listing';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import { Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import type { GithubEventCard } from '../github-event/github-event';
import { HeaderSection } from './components/isolated/header-section';
import { CiSection } from './components/isolated/ci-section';
import { ReviewSection } from './components/isolated/review-section';

import {
  renderPrActionLabel,
  getStateColor,
  getPrActionIcon,
  buildCiItems,
  buildCiGroups,
  buildLatestReviewByReviewer,
  computeLatestReviewState,
  findLatestChangesRequestedEvent,
  buildGithubEventCardRef,
  searchEventQuery,
  buildRealmHrefs,
  pluralize,
} from './utils';

class IsolatedTemplate extends Component<typeof PrCard> {
  // ── Realm & card ref ──
  get realmHrefs() {
    return buildRealmHrefs(this.args.model[realmURL]?.href);
  }

  get githubEventCardRef() {
    return buildGithubEventCardRef(import.meta.url);
  }

  // ── Queries ──
  get pullRequestEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'pull_request',
    );
  }

  get checkRunEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'check_run',
    );
  }

  get checkSuiteEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'check_suite',
    );
  }

  get prReviewEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'pull_request_review',
    );
  }

  // ── Live queries ──
  prEventData = this.args.context?.getCards(
    this,
    () => this.pullRequestEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  checkRunEventData = this.args.context?.getCards(
    this,
    () => this.checkRunEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  checkSuiteEventData = this.args.context?.getCards(
    this,
    () => this.checkSuiteEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  prReviewEventData = this.args.context?.getCards(
    this,
    () => this.prReviewEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  // ── PR state ──
  get latestPrEventInstance(): GithubEventCard | null {
    return (this.prEventData?.instances[0] as GithubEventCard) ?? null;
  }

  get latestPrActionLabel() {
    return renderPrActionLabel(this.latestPrEventInstance?.action);
  }

  get pillColor() {
    return getStateColor(this.latestPrActionLabel);
  }

  get prActionIcon() {
    return getPrActionIcon(this.latestPrActionLabel);
  }

  get prTitle() {
    return this.args.model.prTitle ?? 'Pull Request';
  }

  get prUrl() {
    return this.args.model.prUrl ?? null;
  }

  // ── CI ──
  get ciItems() {
    return buildCiItems(
      this.checkRunEventData?.instances ?? [],
      this.checkSuiteEventData?.instances ?? [],
      this.args.model.prNumber,
    );
  }

  get ciGroups() {
    return buildCiGroups(this.ciItems);
  }

  // ── Reviews ──
  get latestReviewByReviewer() {
    return buildLatestReviewByReviewer(this.prReviewEventData?.instances ?? []);
  }

  get latestReviewState() {
    return computeLatestReviewState(this.latestReviewByReviewer);
  }

  get latestPrReviewCommentEventInstance() {
    return findLatestChangesRequestedEvent(this.latestReviewByReviewer);
  }

  get latestChangesRequestedReviewerName() {
    return (
      this.latestPrReviewCommentEventInstance?.payload?.review?.user?.login ??
      'Unknown reviewer'
    );
  }

  get latestChangesRequestedComment() {
    let comment =
      this.latestPrReviewCommentEventInstance?.payload?.review?.body?.trim();
    return comment || '-';
  }

  get latestChangesRequestedReviewUrl() {
    return this.latestPrReviewCommentEventInstance?.payload?.review?.html_url;
  }

  get hasReview() {
    return !!this.latestPrReviewCommentEventInstance;
  }

  <template>
    <article class='pr-card'>
      <HeaderSection
        @title={{this.prTitle}}
        @prNumber={{@model.prNumber}}
        @prUrl={{this.prUrl}}
        @actionLabel={{this.latestPrActionLabel}}
        @actionIcon={{this.prActionIcon}}
        @pillColor={{this.pillColor}}
        @submittedBy={{@model.submittedBy}}
      >
        <:date>
          {{#if @model.submittedAt}}
            <@fields.submittedAt />
          {{/if}}
        </:date>
      </HeaderSection>

      {{! ── Body ── }}
      <div class='pr-body'>
        <section class='pr-status-columns'>
          <CiSection @ciGroups={{this.ciGroups}} />
          <hr class='status-divider' />
          <ReviewSection
            @reviewState={{this.latestReviewState}}
            @reviewerName={{this.latestChangesRequestedReviewerName}}
            @comment={{this.latestChangesRequestedComment}}
            @reviewUrl={{this.latestChangesRequestedReviewUrl}}
            @hasReview={{this.hasReview}}
          />
        </section>

        {{! ── Listing ── }}
        {{#if @model.listing}}
          <section class='listing-section'>
            <h2 class='section-heading'>View Listing</h2>
            <div class='listing-embed'>
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

      /* ── Body ── */
      .pr-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--card, #ffffff);
        color: var(--card-foreground, #1f2328);
        overflow-y: auto;
      }

      /* ── Status columns ── */
      .pr-status-columns {
        display: flex;
        flex-wrap: wrap;
      }
      .status-divider {
        width: 1px;
        border: none;
        background: var(--border, var(--boxel-border-color));
        flex-shrink: 0;
        margin: var(--boxel-sp-lg) 0;
      }

      .section-heading {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--foreground, #1f2328);
        margin: 0;
      }

      /* ── Listing section ── */
      .listing-section {
        padding: var(--boxel-sp) var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .listing-embed {
        border: 2px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease;
        cursor: pointer;
      }
      .listing-embed:hover {
        border-color: var(--primary, #0969da);
        box-shadow: 0 0 0 3px
          color-mix(in srgb, var(--primary, #0969da) 15%, transparent);
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof PrCard> {
  // ── Realm & card ref ──
  get realmHrefs() {
    return buildRealmHrefs(this.args.model[realmURL]?.href);
  }

  get githubEventCardRef() {
    return buildGithubEventCardRef(import.meta.url);
  }

  // ── Queries ──
  get pullRequestEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'pull_request',
    );
  }

  get checkRunEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'check_run',
    );
  }

  get checkSuiteEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'check_suite',
    );
  }

  get prReviewEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.prNumber,
      'pull_request_review',
    );
  }

  // ── Live queries ──
  prEventData = this.args.context?.getCards(
    this,
    () => this.pullRequestEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  checkRunEventData = this.args.context?.getCards(
    this,
    () => this.checkRunEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  checkSuiteEventData = this.args.context?.getCards(
    this,
    () => this.checkSuiteEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  prReviewEventData = this.args.context?.getCards(
    this,
    () => this.prReviewEventQuery,
    () => this.realmHrefs,
    { isLive: true },
  );

  // ── PR state ──
  get latestPrEventInstance(): GithubEventCard | null {
    return (this.prEventData?.instances[0] as GithubEventCard) ?? null;
  }

  get latestPrActionLabel() {
    return renderPrActionLabel(this.latestPrEventInstance?.action);
  }

  get pillColor() {
    return getStateColor(this.latestPrActionLabel);
  }

  get prActionIcon() {
    return getPrActionIcon(this.latestPrActionLabel);
  }

  get prTitle() {
    return this.args.model.prTitle ?? 'Pull Request';
  }

  get prUrl() {
    return this.args.model.prUrl ?? null;
  }

  // ── CI ──
  get ciItems() {
    return buildCiItems(
      this.checkRunEventData?.instances ?? [],
      this.checkSuiteEventData?.instances ?? [],
      this.args.model.prNumber,
    );
  }

  get ciFailedCount() {
    return this.ciItems.filter((i) => i.state === 'failure').length;
  }

  get ciSuccessCount() {
    return this.ciItems.filter((i) => i.state === 'success').length;
  }

  get ciInProgressCount() {
    return this.ciItems.filter((i) => i.state === 'in_progress').length;
  }

  get ciTotalCount() {
    return this.ciItems.length;
  }

  get ciHeadline() {
    if (this.ciTotalCount === 0) return null;
    if (this.ciFailedCount > 0) return 'Some checks were not successful';
    if (this.ciInProgressCount > 0) return 'Some checks are in progress';
    return 'All checks have passed';
  }

  get ciSubtitle() {
    if (this.ciTotalCount === 0) return null;
    let parts: string[] = [];
    if (this.ciFailedCount > 0) parts.push(`${this.ciFailedCount} failing`);
    if (this.ciInProgressCount > 0)
      parts.push(`${this.ciInProgressCount} in progress`);
    if (this.ciSuccessCount > 0)
      parts.push(`${this.ciSuccessCount} successful`);
    let suffix = pluralize(this.ciTotalCount, 'check', 'checks');
    return `${parts.join(', ')} ${suffix}`;
  }

  get ciDonutStyle() {
    let success = this.ciSuccessCount;
    let failed = this.ciFailedCount;
    let total = this.ciTotalCount;
    if (total === 0) return 'background: var(--muted-foreground, #656d76)';
    let successPct = (success / total) * 100;
    let failedPct = (failed / total) * 100;
    let s1 = successPct;
    let s2 = s1 + failedPct;
    return `background: conic-gradient(var(--chart-1, #28a745) 0% ${s1}%, var(--destructive, #d73a49) ${s1}% ${s2}%, var(--chart-4, #dbab09) ${s2}% 100%)`;
  }

  // ── Reviews ──
  get latestReviewByReviewer() {
    return buildLatestReviewByReviewer(this.prReviewEventData?.instances ?? []);
  }

  get latestReviewState() {
    return computeLatestReviewState(this.latestReviewByReviewer);
  }

  get latestPrReviewCommentEventInstance() {
    return findLatestChangesRequestedEvent(this.latestReviewByReviewer);
  }

  get latestChangesRequestedReviewerName() {
    return (
      this.latestPrReviewCommentEventInstance?.payload?.review?.user?.login ??
      'Unknown reviewer'
    );
  }

  get latestChangesRequestedComment() {
    let comment =
      this.latestPrReviewCommentEventInstance?.payload?.review?.body?.trim();
    return comment || '';
  }

  get latestChangesRequestedReviewUrl() {
    return this.latestPrReviewCommentEventInstance?.payload?.review?.html_url;
  }

  <template>
    <article class='pr-card'>
      {{! ── Hero ── }}
      <header class='pr-hero'>
        <div class='pr-title-row'>
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
            class='pr-github-link'
            title='Open PR on GitHub'
            aria-label='Open PR on GitHub'
          >
            <ExternalLinkIcon class='pr-github-link-icon' />
          </a>
        </div>

        <div class='pr-meta'>
          <Pill class='pr-state-pill' @pillBackgroundColor={{this.pillColor}}>
            <:iconLeft>
              <this.prActionIcon class='pr-state-icon' />
            </:iconLeft>
            <:default>
              <span class='pr-state-label'>{{this.latestPrActionLabel}}</span>
            </:default>
          </Pill>

          {{#if @model.submittedBy}}
            <span class='pr-meta-sep'>·</span>
            <span class='pr-author'>{{@model.submittedBy}}</span>
          {{/if}}
        </div>
      </header>

      {{! ── CI status row ── }}
      {{#if this.ciHeadline}}
        <div class='ci-status-row'>
          <span class='ci-donut' style={{this.ciDonutStyle}}>
            <span class='ci-donut-hole'></span>
          </span>
          <div class='ci-status-text'>
            <span class='ci-headline'>{{this.ciHeadline}}</span>
            <span class='ci-subtitle'>{{this.ciSubtitle}}</span>
          </div>
        </div>
      {{/if}}

      {{! ── Review status row ── }}
      {{#if (eq this.latestReviewState 'changes_requested')}}
        <div class='review-status-row review-status-row--changes'>
          <span class='review-status-label'>Changes Requested</span>
        </div>
      {{else if (eq this.latestReviewState 'approved')}}
        <div class='review-status-row review-status-row--approved'>
          <span class='review-status-label'>Approved</span>
        </div>
      {{/if}}

      {{! ── Changes requested comment (shown at bigger sizes) ── }}
      {{#if this.latestChangesRequestedComment}}
        <div class='review-comment-section'>
          <div class='review-comment-header'>
            <span
              class='review-comment-author'
            >{{this.latestChangesRequestedReviewerName}}</span>
            {{#if this.latestChangesRequestedReviewUrl}}
              <a
                href={{this.latestChangesRequestedReviewUrl}}
                target='_blank'
                rel='noopener noreferrer'
                class='review-comment-link'
                aria-label='View review on GitHub'
              >
                <ExternalLinkIcon class='review-comment-link-icon' />
              </a>
            {{/if}}
          </div>
          <blockquote
            class='review-comment'
          >{{this.latestChangesRequestedComment}}</blockquote>
        </div>
      {{/if}}

      {{! ── Listing (biggest sizes) ── }}
      {{#if @model.listing}}
        <div class='listing-section'>
          <h2 class='listing-heading'>View Listing</h2>
          <@fields.listing @format='atom' />
        </div>
      {{/if}}
    </article>

    <style scoped>
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
        background: #0d1117;
        color: #e6edf3;
        border-bottom: 1px solid #30363d;
      }
      .pr-title-row {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .pr-title {
        margin: 0;
        font-size: var(--boxel-font-sm);
        font-weight: 600;
        color: #e6edf3;
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
        color: #8b949e;
        white-space: nowrap;
      }
      .pr-github-link {
        color: #8b949e;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        transition: color 0.12s ease;
        padding-top: 2px;
      }
      .pr-github-link:hover {
        color: #58a6ff;
      }
      .pr-github-link-icon {
        width: 13px;
        height: 13px;
      }
      .pr-meta {
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
      .pr-state-icon {
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
        color: #484f58;
        font-size: var(--boxel-font-xs);
      }
      .pr-author {
        font-size: var(--boxel-font-xs);
        color: #8b949e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }

      /* ── CI status row ── */
      .ci-status-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card, #ffffff);
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
        min-width: 0;
      }
      .ci-donut {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ci-donut-hole {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--card, #ffffff);
      }
      .ci-status-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .ci-headline {
        font-size: var(--boxel-font-sm);
        font-weight: 600;
        color: var(--foreground, #1f2328);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ci-subtitle {
        font-size: var(--boxel-font-xs);
        color: var(--muted-foreground, #656d76);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ── Review status row ── */
      .review-status-row {
        display: flex;
        align-items: center;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
      }
      .review-status-row--changes {
        background: color-mix(in srgb, var(--destructive, #d73a49) 5%, var(--card, #ffffff));
      }
      .review-status-row--approved {
        background: color-mix(in srgb, var(--chart-1, #28a745) 5%, var(--card, #ffffff));
      }
      .review-status-label {
        font-size: var(--boxel-font-sm);
        font-weight: 600;
      }
      .review-status-row--changes .review-status-label {
        color: var(--destructive, #d73a49);
      }
      .review-status-row--approved .review-status-label {
        color: var(--chart-1, #28a745);
      }
      .review-comment-section {
        display: none;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card, #ffffff);
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
      }
      .review-comment-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xs);
      }
      .review-comment-author {
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        color: var(--foreground, #1f2328);
      }
      .review-comment-link {
        margin-left: auto;
        color: var(--muted-foreground, #656d76);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: color 0.15s ease;
        flex-shrink: 0;
      }
      .review-comment-link:hover {
        color: var(--primary, #0969da);
      }
      .review-comment-link-icon {
        width: 13px;
        height: 13px;
      }
      .review-comment {
        margin-block: 0;
        margin-inline: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-sm);
        color: var(--card-foreground, #1f2328);
        border-left: 3px solid var(--border, var(--boxel-border-color));
        font-style: normal;
        line-height: 1.6;
        background: var(--card, #ffffff);
        border-radius: 0 var(--radius, 6px) var(--radius, 6px) 0;
        transition:
          border-left-color 0.15s ease,
          background 0.15s ease;
        cursor: default;
        white-space: pre-line;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
      }
      .review-comment:hover {
        border-left-color: var(--destructive, #d73a49);
        background: color-mix(in srgb, var(--destructive, #d73a49) 5%, var(--card, #ffffff));
      }

      /* ── Listing ── */
      .listing-section {
        display: none;
        align-items: center;
        justify-content: end;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--card, #ffffff);
        border: 1px solid var(--border, var(--boxel-border-color));
        margin-top: auto;
      }
      .listing-heading {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, #656d76);
        margin: 0;
      }

      /* ── Container queries ── */

      /* Short: hide CI/review rows, hero fills card */
      @container fitted-card (height <= 80px) {
        .ci-status-row,
        .review-status-row {
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
        .pr-author,
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
        .pr-title-row {
          flex: 1;
          min-width: 0;
          align-items: center;
        }
        .pr-meta {
          flex-shrink: 0;
          flex-wrap: nowrap;
        }
      }

      /* Tiny: just title */
      @container fitted-card (height <= 40px) {
        .pr-meta {
          display: none;
        }
      }

      /* Narrow: hide secondary text */
      @container fitted-card (width < 220px) {
        .pr-author,
        .pr-meta-sep {
          display: none;
        }
      }

      /* Narrow: hide CI subtitle */
      @container fitted-card (width < 150px) {
        .ci-subtitle {
          display: none;
        }
      }

      /* Extra tiny: hide number, clamp to 1 line */
      @container fitted-card (width < 100px) {
        .pr-number {
          display: none;
        }
        .pr-title {
          -webkit-line-clamp: 1;
          font-size: 10px;
        }
      }

      /* Wide + short banner: ≥300px wide, 80–120px tall */
      @container fitted-card (300px <= width) and (80px < height) and (height <= 120px) {
        .ci-status-row,
        .review-status-row {
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
        .pr-title-row {
          flex: 1;
          min-width: 0;
          align-items: center;
        }
        .pr-meta {
          flex-shrink: 0;
          flex-wrap: nowrap;
        }
      }

      /* Medium-wide tile: ≥300px wide, 120–200px tall */
      @container fitted-card (300px <= width) and (120px <= height) and (height < 200px) {
        .pr-hero {
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .pr-title {
          font-size: 1rem;
        }
      }

      /* Narrow tall tile: <400px wide, ≥200px tall — show review comment */
      @container fitted-card (width < 400px) and (200px <= height) {
        .review-comment-section {
          display: block;
        }
      }

      /* Large */
      @container fitted-card (400px <= width) and (200px <= height) {
        .pr-hero {
          padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
          gap: var(--boxel-sp-xs);
        }
        .pr-title {
          font-size: 1.25rem;
          -webkit-line-clamp: 3;
        }
        .pr-github-link-icon {
          width: 18px;
          height: 18px;
        }
        .pr-state-icon {
          width: 15px;
          height: 15px;
        }
        .pr-state-label {
          font-size: var(--boxel-font-sm);
        }
        .pr-author {
          font-size: var(--boxel-font-sm);
          max-width: 200px;
        }
        .ci-status-row {
          padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        }
        .ci-donut {
          width: 36px;
          height: 36px;
        }
        .ci-donut-hole {
          width: 20px;
          height: 20px;
        }
        .review-status-row {
          padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        }
        .review-comment-section {
          display: block;
        }
      }

      /* Very wide */
      @container fitted-card (500px <= width) and (200px <= height) {
        .pr-hero {
          padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
        }
        .pr-title {
          font-size: 1.4rem;
          -webkit-line-clamp: 3;
        }
        .pr-github-link-icon {
          width: 20px;
          height: 20px;
        }
        .pr-author {
          max-width: 280px;
        }
        .ci-status-row,
        .review-status-row {
          padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
        }
        .review-comment-section {
          padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
        }
      }

      /* Extra-large: show listing */
      @container fitted-card (400px <= width) and (280px <= height) {
        .listing-section {
          display: flex;
          padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        }
      }

      @container fitted-card (500px <= width) and (280px <= height) {
        .listing-section {
          padding: var(--boxel-sp-sm) var(--boxel-sp-xl);
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
      if (this.prTitle) {
        return this.prTitle;
      }

      if (this.prNumber !== null && this.prNumber !== undefined) {
        return `PR #${this.prNumber}`;
      }

      return 'Pull request';
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = IsolatedTemplate;
  static fitted = FittedTemplate;
}

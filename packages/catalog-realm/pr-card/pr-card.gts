import {
  CardDef,
  Component,
  StringField,
  field,
  contains,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import CopyIcon from '@cardstack/boxel-icons/copy';
import { Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import type { GithubEventCard } from '../github-event/github-event';
import { HeaderSection } from './components/isolated/header-section';
import { CiSection } from './components/isolated/ci-section';
import { ReviewSection } from './components/isolated/review-section';
import { SummarySection } from './components/isolated/summary-section';

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
    let event = this.latestPrEventInstance;
    return renderPrActionLabel(
      event?.action,
      event?.payload?.pull_request?.merged,
    );
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

  get prBranchName() {
    return (
      this.args.model.branchName ??
      this.latestPrEventInstance?.payload?.pull_request?.head?.ref ??
      null
    );
  }

  get prBodySummary() {
    let body = this.latestPrEventInstance?.payload?.pull_request?.body?.trim();
    return body || 'No pull request summary provided.';
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
        @branchName={{this.prBranchName}}
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

        <SummarySection @summary={{this.prBodySummary}} />
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
    let event = this.latestPrEventInstance;
    return renderPrActionLabel(
      event?.action,
      event?.payload?.pull_request?.merged,
    );
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

  get prBranchName() {
    return (
      this.args.model.branchName ??
      this.latestPrEventInstance?.payload?.pull_request?.head?.ref ??
      null
    );
  }

  get prBodySummary() {
    let body = this.latestPrEventInstance?.payload?.pull_request?.body?.trim();
    return body || 'No pull request summary provided.';
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

  copyBranchName = async () => {
    let branchName = this.prBranchName?.trim();
    if (!branchName) {
      return;
    }
    await navigator.clipboard.writeText(branchName);
  };

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

          {{#if this.prBranchName}}
            <span class='pr-meta-sep'>·</span>
            <span class='pr-branch'>
              <span class='pr-branch-label'>{{this.prBranchName}}</span>
              <button
                type='button'
                class='pr-branch-copy-button'
                {{on 'click' this.copyBranchName}}
                aria-label='Copy branch name'
                title='Copy branch name'
              >
                <CopyIcon class='pr-branch-copy-icon' />
              </button>
            </span>
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

      <div class='summary-section'>
        <p class='summary-content'>{{this.prBodySummary}}</p>
      </div>
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
      .pr-branch {
        font-size: var(--boxel-font-xs);
        color: var(--pr-branch-foreground, #9ecbff);
        border: 1px solid var(--pr-branch-border, #3d444d);
        border-radius: 999px;
        padding: 1px 4px 1px 8px;
        max-width: 180px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .pr-branch-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pr-branch-copy-button {
        border: none;
        background: transparent;
        color: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px;
        border-radius: 999px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .pr-branch-copy-button:hover {
        background: color-mix(
          in srgb,
          var(--pr-branch-foreground, #9ecbff) 20%,
          transparent
        );
      }
      .pr-branch-copy-icon {
        width: 11px;
        height: 11px;
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
        background: color-mix(
          in srgb,
          var(--destructive, #d73a49) 5%,
          var(--card, #ffffff)
        );
      }
      .review-status-row--approved {
        background: color-mix(
          in srgb,
          var(--chart-1, #28a745) 5%,
          var(--card, #ffffff)
        );
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
      /* ── Summary ── */
      .summary-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        background: var(--card, #ffffff);
        border-top: 1px solid var(--border, var(--boxel-border-color));
        height: 100%;
      }
      .summary-content {
        margin: 0;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, 6px);
        padding: var(--boxel-sp-sm);
        background: var(--muted, #f6f8fa);
        color: var(--card-foreground, #1f2328);
        line-height: 1.7;
        white-space: pre-line;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 7;
        text-overflow: ellipsis;
        overflow: hidden;
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
        .pr-meta-sep,
        .pr-branch {
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
      }

      /* Extra-large summary spacing */
      @container fitted-card (500px <= width) and (280px <= height) {
        .summary-content {
          -webkit-line-clamp: 2;
        }
      }
    </style>
  </template>
}

export class PrCard extends CardDef {
  static displayName = 'PR Card';
  static icon = GitPullRequestIcon;
  static headerColor = '#24292f';

  // === PR identity (set on the card instance) ===
  @field prNumber = contains(NumberField);
  @field prUrl = contains(StringField);
  @field prTitle = contains(StringField);
  @field branchName = contains(StringField);

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

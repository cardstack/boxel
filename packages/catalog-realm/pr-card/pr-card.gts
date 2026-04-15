import {
  CardDef,
  Component,
  StringField,
  field,
  contains,
  containsMany,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { FileContentField } from '../fields/file-content';
import GitPullRequestIcon from '@cardstack/boxel-icons/git-pull-request';
import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import CopyIcon from '@cardstack/boxel-icons/copy';
import { Pill } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import type { GithubEventCard } from '../github-event/github-event';
import { HeaderSection } from './components/isolated/header-section';
import { CiSection } from './components/isolated/ci-section';
import { ReviewSection } from './components/isolated/review-section';
import { MergeableSection } from './components/isolated/mergeable-section';
import { PrCiStatusField } from './fields/ci-status-field';
import { PrReviewStatusField } from './fields/review-status-field';

import {
  renderPrActionLabel,
  getStateColor,
  getPrActionIcon,
  buildCiItems,
  buildCiGroups,
  buildLatestReviewByReviewer,
  computeLatestReviewState,
  findLatestChangesRequestedEvent,
  findLatestApprovedEvent,
  buildGithubEventCardRef,
  searchEventQuery,
  buildRealmHrefs,
} from './utils';

class IsolatedTemplate extends Component<typeof PrCard> {
  // ── Realm & card ref ──
  get realmHrefs() {
    return buildRealmHrefs(this.args.model[realmURL]?.href);
  }

  get githubEventCardRef() {
    // @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
    return buildGithubEventCardRef(import.meta.url);
  }

  // ── Queries ──
  get pullRequestEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.branchName,
      'pull_request',
    );
  }

  get checkRunEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.branchName,
      'check_run',
    );
  }

  get checkSuiteEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.branchName,
      'check_suite',
    );
  }

  get prReviewEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.branchName,
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
    return (
      this.latestPrEventInstance?.payload?.pull_request?.title ?? 'Pull Request'
    );
  }

  get prNumber() {
    return this.latestPrEventInstance?.prNumber ?? null;
  }

  get prUrl() {
    return this.latestPrEventInstance?.payload?.pull_request?.html_url ?? null;
  }

  get prBranchName() {
    return (
      this.args.model.branchName ??
      this.latestPrEventInstance?.payload?.pull_request?.head?.ref ??
      null
    );
  }

  // ── CI ──
  get ciItems() {
    return buildCiItems(
      this.checkRunEventData?.instances ?? [],
      this.checkSuiteEventData?.instances ?? [],
    );
  }

  get ciGroups() {
    return buildCiGroups(this.ciItems);
  }

  get ciIsLoading() {
    return (
      this.checkRunEventData?.isLoading ||
      this.checkSuiteEventData?.isLoading
    ) ?? false;
  }

  // ── Reviews ──
  get latestReviewByReviewer() {
    return buildLatestReviewByReviewer(this.prReviewEventData?.instances ?? []);
  }

  get latestReviewState() {
    return computeLatestReviewState(this.latestReviewByReviewer);
  }

  get latestPrReviewEventInstance() {
    let state = this.latestReviewState;
    if (state === 'changes_requested') {
      return findLatestChangesRequestedEvent(this.latestReviewByReviewer);
    }
    if (state === 'approved') {
      return findLatestApprovedEvent(this.latestReviewByReviewer);
    }
    return null;
  }

  get latestReviewComment() {
    let comment =
      this.latestPrReviewEventInstance?.payload?.review?.body?.trim();
    return comment || '-';
  }

  get latestReviewCommentUrl() {
    return this.latestPrReviewEventInstance?.payload?.review?.html_url;
  }

  get hasReview() {
    return !!this.latestPrReviewEventInstance;
  }

  get latestReviewerName() {
    return (
      this.latestPrReviewEventInstance?.payload?.review?.user?.login ?? null
    );
  }

  // ── Mergeability ──
  get isClosed() {
    let label = this.latestPrActionLabel;
    return label === 'Closed' || label === 'Merged';
  }

  get isDraft() {
    return this.latestPrActionLabel === 'Draft';
  }

  get mergeBlockReasons(): string[] {
    if (this.isClosed) return [];
    let reasons: string[] = [];
    if (this.isDraft) {
      reasons.push('This pull request is still a work in progress');
    }
    let { ciItems } = this;
    if (ciItems.some((i) => i.state === 'failure')) {
      reasons.push('Some checks were not successful');
    } else if (ciItems.some((i) => i.state === 'in_progress')) {
      reasons.push('Some checks are still in progress');
    }
    let reviewState = this.latestReviewState;
    if (reviewState === 'changes_requested') {
      reasons.push('Changes were requested by a reviewer');
    } else if (reviewState !== 'approved') {
      reasons.push(
        'At least 1 approving review is required by reviewers with write access',
      );
    }
    return reasons;
  }

  get isMergeable() {
    if (this.isClosed) return false;
    return this.mergeBlockReasons.length === 0;
  }

  <template>
    <article class='pr-card'>
      <HeaderSection
        @title={{this.prTitle}}
        @prNumber={{this.prNumber}}
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
          <CiSection @ciGroups={{this.ciGroups}} @isLoading={{this.ciIsLoading}} />
          <hr class='status-divider' />
          <ReviewSection
            @reviewState={{this.latestReviewState}}
            @reviewerName={{this.latestReviewerName}}
            @comment={{this.latestReviewComment}}
            @reviewUrl={{this.latestReviewCommentUrl}}
            @hasReview={{this.hasReview}}
          />
        </section>

        <MergeableSection
          @isMergeable={{this.isMergeable}}
          @isClosedOrMerged={{this.isClosed}}
          @blockReasons={{this.mergeBlockReasons}}
        />

        {{#if @model.prSummary}}
          <@fields.prSummary />
        {{/if}}
      </div>
    </article>

    <style scoped>
      .pr-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
      }

      /* ── Body ── */
      .pr-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--card, #ffffff);
        color: var(--card-foreground, #1f2328);
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

      /* ── Summary section ── */
      .pr-card :deep(.markdown-content) {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
      }
      .pr-card :deep(.markdown-content) > h2 {
        margin-top: 0;
      }
      .pr-card :deep(.markdown-content) > ul {
        list-style-position: inside;
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
    // @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
    return buildGithubEventCardRef(import.meta.url);
  }

  // ── Queries ──
  get pullRequestEventQuery() {
    return searchEventQuery(
      this.githubEventCardRef,
      this.args.model.branchName,
      'pull_request',
    );
  }

  // ── Live queries ──
  prEventData = this.args.context?.getCards(
    this,
    () => this.pullRequestEventQuery,
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
    return (
      this.latestPrEventInstance?.payload?.pull_request?.title ?? 'Pull Request'
    );
  }

  get prNumber() {
    return this.latestPrEventInstance?.prNumber ?? null;
  }

  get prUrl() {
    return this.latestPrEventInstance?.payload?.pull_request?.html_url ?? null;
  }

  get prBranchName() {
    return (
      this.args.model.branchName ??
      this.latestPrEventInstance?.payload?.pull_request?.head?.ref ??
      null
    );
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
            {{#if this.prNumber}}
              <span class='pr-number'>#{{this.prNumber}}</span>
            {{/if}}
          </p>
          {{#if this.prUrl}}
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
          {{/if}}
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
      <@fields.ciStatus />

      {{! ── Review status row ── }}
      <@fields.reviewStatus />

      {{#if @model.prSummary}}
        <@fields.prSummary />
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

      /* ── Summary ── */
      .pr-card :deep(.markdown-content) {
        padding: var(--boxel-sp-sm) var(--boxel-sp);
      }
      .pr-card :deep(.markdown-content) > h2 {
        margin-top: 0;
      }
      .pr-card :deep(.markdown-content) > ul {
        list-style-position: inside;
      }
      .pr-card :deep(.markdown-content) > ul li {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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

  @field branchName = contains(StringField);
  @field prSummary = contains(MarkdownField);

  // === Provenance (set on the card instance) ===
  @field submittedBy = contains(StringField);
  @field submittedAt = contains(DatetimeField);

  // === Submission file contents ===
  @field allFileContents = containsMany(FileContentField);

  // === Computed ===
  @field cardTitle = contains(StringField, {
    computeVia(this: PrCard) {
      return 'Pull request';
    },
  });

  // === Status fields (computed from branchName) ===
  @field ciStatus = contains(PrCiStatusField, {
    computeVia(this: PrCard) {
      let field = new PrCiStatusField();
      field.branchName = this.branchName;
      return field;
    },
  });

  @field reviewStatus = contains(PrReviewStatusField, {
    computeVia(this: PrCard) {
      let field = new PrReviewStatusField();
      field.branchName = this.branchName;
      return field;
    },
  });

  static isolated = IsolatedTemplate;
  static embedded = IsolatedTemplate;
  static fitted = FittedTemplate;
}

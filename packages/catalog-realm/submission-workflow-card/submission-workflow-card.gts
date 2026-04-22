import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  linksTo,
  field,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import SourceCode from '@cardstack/boxel-icons/source-code';

import { Listing } from '../catalog-app/listing/listing';
import { PrCard } from '../pr-card/pr-card';
import { PrCiStatusField } from '../pr-card/fields/ci-status-field';
import { PrReviewStatusField } from '../pr-card/fields/review-status-field';
import type { GithubEventCard } from '../github-event/github-event';

import {
  renderPrActionLabel,
  buildCiItems,
  buildLatestReviewByReviewer,
  computeLatestReviewState,
  buildGithubEventCardRef,
  searchEventQuery,
  buildRealmHrefs,
} from '../pr-card/utils';

// ── Step status types ──

type StepStatus =
  | 'completed'
  | 'current'
  | 'upcoming'
  | 'blocked'
  | 'in-progress';

interface ResolvedStep {
  key: string;
  label: string;
  description: string;
  status: StepStatus;
  statusDetail?: string;
}

interface WorkflowState {
  steps: ResolvedStep[];
  currentStepIndex: number;
  progressPercent: number;
  overallStatus: 'not-started' | 'in-progress' | 'blocked' | 'completed';
}

// ── Step definitions ──

const STEP_DEFINITIONS = [
  {
    key: 'choose-listing',
    label: 'Choose a Listing',
    description: 'Select the card, field, skill, or theme listing to submit',
  },
  {
    key: 'create-pr',
    label: 'Lint & Create PR',
    description:
      'Lint files, auto-fix issues, and create a GitHub pull request',
  },
  {
    key: 'ci-checks',
    label: 'CI Checks',
    description: 'Automated checks must pass before merge',
  },
  {
    key: 'reviewer-approve',
    label: 'Reviewer Approve',
    description: 'A reviewer with write access must approve the PR',
  },
  {
    key: 'merge-catalog',
    label: 'Merge into Catalog',
    description: 'The PR is merged and the listing is live in the catalog',
  },
];

// ── Helper: resolve live workflow state ──

function resolveSubmissionWorkflowState(
  hasListing: boolean,
  hasPr: boolean,
  _prActionLabel: string | null,
  ciAllPassed: boolean,
  ciHasFailure: boolean,
  ciInProgress: boolean,
  ciIsLoading: boolean,
  reviewState: string | null,
  isMerged: boolean,
  isClosed: boolean,
  lintStatus: string | null,
  lintErrors: string[],
  prCreationError: string | null,
): WorkflowState {
  let steps: ResolvedStep[] = [];
  let firstIncomplete = -1;

  for (let i = 0; i < STEP_DEFINITIONS.length; i++) {
    let def = STEP_DEFINITIONS[i];
    let completed = false;
    let blocked = false;
    let inProgress = false;
    let statusDetail: string | undefined;

    switch (def.key) {
      case 'choose-listing':
        completed = hasListing;
        break;
      case 'create-pr':
        completed = hasPr;
        if (!hasPr && lintStatus === 'in-progress') {
          inProgress = true;
          statusDetail = 'Linting files...';
        } else if (!hasPr && lintStatus === 'failed') {
          blocked = true;
          statusDetail = `${lintErrors.length} unfixable lint error${lintErrors.length === 1 ? '' : 's'}`;
        } else if (!hasPr && prCreationError) {
          blocked = true;
          statusDetail = 'PR creation failed';
        } else if (!hasPr && lintStatus === 'passed') {
          inProgress = true;
          statusDetail = 'Creating PR...';
        }
        break;
      case 'ci-checks':
        completed = hasPr && ciAllPassed;
        blocked = hasPr && ciHasFailure;
        if (hasPr && ciInProgress) {
          inProgress = true;
          statusDetail = 'Checks are running...';
        } else if (hasPr && ciIsLoading && !ciAllPassed && !ciHasFailure) {
          inProgress = true;
          statusDetail = 'Loading check status...';
        }
        break;
      case 'reviewer-approve':
        completed = hasPr && reviewState === 'approved';
        blocked = hasPr && reviewState === 'changes_requested';
        break;
      case 'merge-catalog':
        completed = isMerged;
        blocked = isClosed && !isMerged;
        break;
    }

    let status: StepStatus;
    if (completed) {
      status = 'completed';
    } else if (inProgress) {
      status = 'in-progress';
      if (firstIncomplete === -1) firstIncomplete = i;
    } else if (blocked) {
      status = 'blocked';
      if (firstIncomplete === -1) firstIncomplete = i;
    } else if (firstIncomplete === -1) {
      status = 'current';
      firstIncomplete = i;
    } else {
      status = 'upcoming';
    }

    steps.push({
      key: def.key,
      label: def.label,
      description: def.description,
      status,
      statusDetail,
    });
  }

  if (firstIncomplete === -1) {
    firstIncomplete = STEP_DEFINITIONS.length;
  }

  let completedCount = steps.filter((s) => s.status === 'completed').length;
  let total = steps.length;
  let progressPercent = Math.round((completedCount / total) * 100);

  let overallStatus: WorkflowState['overallStatus'];
  if (completedCount === total) {
    overallStatus = 'completed';
  } else if (steps.some((s) => s.status === 'blocked')) {
    overallStatus = 'blocked';
  } else if (completedCount > 0) {
    overallStatus = 'in-progress';
  } else {
    overallStatus = 'not-started';
  }

  return {
    steps,
    currentStepIndex: firstIncomplete,
    progressPercent,
    overallStatus,
  };
}

// ── Participant field ──

export class SubmissionParticipantField extends FieldDef {
  static displayName = 'Submission Participant';
  @field name = contains(StringField);
  @field role = contains(StringField);
  @field initials = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='participant'>
        <span class='participant-avatar'>{{@model.initials}}</span>
        <div class='participant-info'>
          <span class='participant-name'>{{@model.name}}</span>
          <span class='participant-role'>{{@model.role}}</span>
        </div>
      </div>
      <style scoped>
        .participant {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .participant-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #1e293b;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .participant-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .participant-name {
          font-size: 12px;
          font-weight: 600;
          color: #1e293b;
        }
        .participant-role {
          font-size: 11px;
          color: #64748b;
        }
      </style>
    </template>
  };
}

// ── Main Card ──

export class SubmissionWorkflowCard extends CardDef {
  static displayName = 'Submission Workflow';
  static prefersWideFormat = true;

  // ── Identity ──
  @field title = contains(StringField);
  @field submittedBy = contains(StringField);

  // ── Submission data ──
  @field roomId = contains(StringField);
  @field branchName = contains(StringField);
  @field catalogRealmUrl = contains(StringField);

  // ── Links to real cards ──
  @field listing = linksTo(() => Listing);
  @field prCard = linksTo(() => PrCard);

  // ── Lint status ──
  @field lintStatus = contains(StringField); // 'pending' | 'in-progress' | 'passed' | 'failed'
  @field lintErrors = containsMany(StringField);
  @field lintFixedCount = contains(NumberField);

  @field prCreationError = contains(StringField);

  // ── Participants ──
  @field participants = containsMany(SubmissionParticipantField);

  // ── Computed title ──
  @field cardTitle = contains(StringField, {
    computeVia: function (this: SubmissionWorkflowCard) {
      return this.title ?? this.listing?.name ?? 'Submission Workflow';
    },
  });

  // ── Status fields (reuse PR card field components) ──
  @field ciStatus = contains(PrCiStatusField, {
    computeVia: function (this: SubmissionWorkflowCard) {
      let bn = this.prCard?.branchName ?? this.branchName;
      let f = new PrCiStatusField();
      f.branchName = bn;
      return f;
    },
  });

  @field reviewStatus = contains(PrReviewStatusField, {
    computeVia: function (this: SubmissionWorkflowCard) {
      let bn = this.prCard?.branchName ?? this.branchName;
      let f = new PrReviewStatusField();
      f.branchName = bn;
      return f;
    },
  });

  // ── Isolated: Full workflow view ──

  static isolated = class Isolated extends Component<
    typeof SubmissionWorkflowCard
  > {
    // ── Realm & card ref for live queries ──
    get realmHrefs() {
      return buildRealmHrefs(this.args.model[realmURL]?.href);
    }

    get githubEventCardRef() {
      return buildGithubEventCardRef(
        // @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
        import.meta.url,
        '../github-event/github-event',
      );
    }

    get prBranchName() {
      return (
        this.args.model.prCard?.branchName ?? this.args.model.branchName ?? null
      );
    }

    // ── Event queries ──
    get pullRequestEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.prBranchName,
        'pull_request',
      );
    }

    get checkRunEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.prBranchName,
        'check_run',
      );
    }

    get checkSuiteEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.prBranchName,
        'check_suite',
      );
    }

    get prReviewEventQuery() {
      return searchEventQuery(
        this.githubEventCardRef,
        this.prBranchName,
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

    // ── Derived PR state ──
    get latestPrEvent(): GithubEventCard | null {
      return (this.prEventData?.instances[0] as GithubEventCard) ?? null;
    }

    get prActionLabel() {
      let event = this.latestPrEvent;
      return renderPrActionLabel(
        event?.action,
        event?.payload?.pull_request?.merged,
      );
    }

    get isMerged() {
      return this.prActionLabel === 'Merged';
    }

    get isClosed() {
      let label = this.prActionLabel;
      return label === 'Closed' || label === 'Merged';
    }

    get catalogListingUrl(): string | null {
      if (!this.isMerged) return null;
      let listing = this.args.model.listing;
      if (!listing?.id) return null;

      let listingRealmHref = listing[realmURL]?.href;
      if (!listingRealmHref) return null;

      let relativePath = listing.id.startsWith(listingRealmHref)
        ? listing.id.slice(listingRealmHref.length)
        : listing.id;

      let catalogRealmUrl = this.args.model.catalogRealmUrl;
      if (!catalogRealmUrl) return null;

      let base = catalogRealmUrl.endsWith('/')
        ? catalogRealmUrl
        : catalogRealmUrl + '/';
      return `${base}${relativePath}`;
    }

    // ── CI state ──
    get ciItems() {
      return buildCiItems(
        this.checkRunEventData?.instances ?? [],
        this.checkSuiteEventData?.instances ?? [],
      );
    }

    get ciAllPassed() {
      return (
        this.ciItems.length > 0 &&
        this.ciItems.every((i) => i.state === 'success')
      );
    }

    get ciHasFailure() {
      return this.ciItems.some((i) => i.state === 'failure');
    }

    get ciInProgress() {
      return this.ciItems.some((i) => i.state === 'in_progress');
    }

    get ciIsLoading() {
      return (
        (this.checkRunEventData?.isLoading ||
          this.checkSuiteEventData?.isLoading) ??
        false
      );
    }

    // ── Review state ──
    get latestReviewByReviewer() {
      return buildLatestReviewByReviewer(
        this.prReviewEventData?.instances ?? [],
      );
    }

    get reviewState() {
      return computeLatestReviewState(this.latestReviewByReviewer);
    }

    // ── Workflow resolution ──
    get workflowState(): WorkflowState {
      return resolveSubmissionWorkflowState(
        !!this.args.model.listing,
        !!this.args.model.prCard,
        this.prActionLabel,
        this.ciAllPassed,
        this.ciHasFailure,
        this.ciInProgress,
        this.ciIsLoading,
        this.reviewState,
        this.isMerged,
        this.isClosed,
        this.args.model.lintStatus ?? null,
        this.args.model.lintErrors ?? [],
        this.args.model.prCreationError ?? null,
      );
    }

    get overallStatusLabel(): string {
      switch (this.workflowState.overallStatus) {
        case 'completed':
          return 'Completed';
        case 'blocked':
          return 'Blocked';
        case 'in-progress':
          return 'In Progress';
        default:
          return 'Not Started';
      }
    }

    get lastStepIndex(): string {
      return String(this.workflowState.steps.length - 1);
    }

    get overallStatusTone(): string {
      switch (this.workflowState.overallStatus) {
        case 'completed':
          return 'success';
        case 'blocked':
          return 'danger';
        case 'in-progress':
          return 'active';
        default:
          return 'neutral';
      }
    }

    get isSourceListing(): boolean {
      return (
        !!this.args.model.listing &&
        !this.args.model.listing[realmURL]?.pathname?.includes('/catalog/')
      );
    }

    <template>
      <div class='sw-layout'>

        {{! ── Main content ── }}
        <main class='sw-main'>
          <header class='sw-header'>
            <div class='sw-header-left'>
              <h1 class='sw-title'>{{@model.title}}</h1>
              <span
                class={{concat 'sw-status-pill ' this.overallStatusTone}}
              >{{this.overallStatusLabel}}</span>
            </div>
            {{#if @model.submittedBy}}
              <span class='sw-submitted-by'>by {{@model.submittedBy}}</span>
            {{/if}}
          </header>

          {{! ── Step tracker ── }}
          <div class='sw-steps'>
            {{#each this.workflowState.steps key='key' as |step idx|}}
              <div class={{concat 'sw-step ' step.status}}>
                <div class='sw-step-indicator'>
                  {{#if (eq step.status 'completed')}}
                    <div class='sw-step-icon completed'>
                      <svg
                        width='12'
                        height='12'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='3'
                      ><polyline points='20 6 9 17 4 12' /></svg>
                    </div>
                  {{else if (eq step.status 'in-progress')}}
                    <div class='sw-step-icon in-progress'>
                      <div class='sw-step-spinner'></div>
                    </div>
                  {{else if (eq step.status 'current')}}
                    <div class='sw-step-icon current'>
                      <div class='sw-step-pulse'></div>
                    </div>
                  {{else if (eq step.status 'blocked')}}
                    <div class='sw-step-icon blocked'>
                      <svg
                        width='12'
                        height='12'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='3'
                      ><line x1='18' y1='6' x2='6' y2='18' /><line
                          x1='6'
                          y1='6'
                          x2='18'
                          y2='18'
                        /></svg>
                    </div>
                  {{else}}
                    <div class='sw-step-icon upcoming'>
                      <div class='sw-step-dot'></div>
                    </div>
                  {{/if}}
                  {{#if (eq idx this.lastStepIndex)}}
                    {{! last step, no connector }}
                  {{else}}
                    <div
                      class={{concat 'sw-step-connector ' step.status}}
                    ></div>
                  {{/if}}
                </div>
                <div class='sw-step-content'>
                  <div class='sw-step-label'>{{step.label}}</div>
                  <div class='sw-step-description'>{{step.description}}</div>

                  {{#if step.statusDetail}}
                    <div class={{concat 'sw-step-status-detail ' step.status}}>
                      {{#if (eq step.status 'in-progress')}}
                        <span class='sw-status-spinner-small'></span>
                      {{/if}}
                      {{step.statusDetail}}
                    </div>
                  {{/if}}

                  {{! ── Step detail cards ── }}
                  {{#if (eq step.key 'choose-listing')}}
                    {{#if @model.listing}}
                      <div class='sw-fitted-card-container'>
                        {{#if this.isSourceListing}}
                          <span class='sw-source-badge'>
                            <SourceCode class='sw-source-icon' />
                            Source Listing
                          </span>
                        {{/if}}
                        <@fields.listing @format='fitted' />
                      </div>
                    {{/if}}
                  {{/if}}

                  {{#if (eq step.key 'create-pr')}}
                    {{#if (eq @model.lintStatus 'failed')}}
                      <div class='sw-step-detail sw-lint-errors'>
                        <div class='sw-lint-header'>Unfixable Lint Errors</div>
                        {{#each @model.lintErrors as |err|}}
                          <div class='sw-lint-error-line'>{{err}}</div>
                        {{/each}}
                      </div>
                    {{/if}}
                    {{#if @model.prCreationError}}
                      <div class='sw-step-detail sw-lint-errors'>
                        <div class='sw-lint-header'>PR Creation Failed</div>
                        <div class='sw-lint-error-line'>
                          {{@model.prCreationError}}
                        </div>
                      </div>
                    {{/if}}
                    {{#if (eq @model.lintStatus 'passed')}}
                      {{#if @model.lintFixedCount}}
                        <div class='sw-step-detail sw-lint-info'>
                          Auto-fixed
                          {{@model.lintFixedCount}}
                          file{{#if
                            (eq @model.lintFixedCount 1)
                          }}{{else}}s{{/if}}
                        </div>
                      {{/if}}
                    {{/if}}
                    {{#if @model.prCard}}
                      <div class='sw-step-detail sw-embedded-card-container'>
                        <@fields.prCard @format='embedded' />
                      </div>
                    {{/if}}
                  {{/if}}

                  {{#if (eq step.key 'ci-checks')}}
                    {{#if @model.prCard}}
                      <div class='sw-step-detail'>
                        <@fields.ciStatus />
                      </div>
                    {{/if}}
                  {{/if}}

                  {{#if (eq step.key 'reviewer-approve')}}
                    {{#if @model.prCard}}
                      <div class='sw-step-detail'>
                        <@fields.reviewStatus />
                      </div>
                    {{/if}}
                  {{/if}}

                  {{#if (eq step.key 'merge-catalog')}}
                    {{#if this.catalogListingUrl}}
                      <div class='sw-step-detail sw-catalog-link'>
                        <BoxelButton
                          @as='anchor'
                          @href={{this.catalogListingUrl}}
                          @kind='primary'
                          @size='small'
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          View listing in catalog
                        </BoxelButton>
                      </div>
                    {{/if}}
                  {{/if}}
                </div>
              </div>
            {{/each}}
          </div>
        </main>

        {{! ── Sidebar ── }}
        <aside class='sw-sidebar'>
          {{! Progress donut }}
          <div class='sw-progress-section'>
            <div
              class={{concat 'sw-donut ' this.overallStatusTone}}
              style={{htmlSafe
                (concat '--pct:' this.workflowState.progressPercent ';')
              }}
            >
              <span
                class='sw-donut-pct'
              >{{this.workflowState.progressPercent}}%</span>
              <span class='sw-donut-label'>complete</span>
            </div>
          </div>

          {{! Step summary }}
          <div class='sw-sidebar-section'>
            <div class='sw-sidebar-heading'>Steps</div>
            {{#each this.workflowState.steps key='key' as |step|}}
              <div class={{concat 'sw-sidebar-step ' step.status}}>
                {{#if (eq step.status 'completed')}}
                  <span class='sw-sidebar-icon completed'>
                    <svg
                      width='10'
                      height='10'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='3'
                    ><polyline points='20 6 9 17 4 12' /></svg>
                  </span>
                {{else if (eq step.status 'in-progress')}}
                  <span class='sw-sidebar-icon in-progress'><span
                      class='sw-sidebar-spinner-small'
                    ></span></span>
                {{else if (eq step.status 'current')}}
                  <span class='sw-sidebar-icon current'><span
                      class='sw-sidebar-dot current'
                    ></span></span>
                {{else if (eq step.status 'blocked')}}
                  <span class='sw-sidebar-icon blocked'>
                    <svg
                      width='10'
                      height='10'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='3'
                    ><line x1='18' y1='6' x2='6' y2='18' /><line
                        x1='6'
                        y1='6'
                        x2='18'
                        y2='18'
                      /></svg>
                  </span>
                {{else}}
                  <span class='sw-sidebar-icon upcoming'><span
                      class='sw-sidebar-dot upcoming'
                    ></span></span>
                {{/if}}
                <span class='sw-sidebar-step-label'>{{step.label}}</span>
              </div>
            {{/each}}
          </div>

          {{! Participants }}
          {{#if @model.participants.length}}
            <div class='sw-sidebar-section'>
              <div class='sw-sidebar-heading'>Participants</div>
              {{#each @model.participants as |p|}}
                <div class='sw-sidebar-participant'>
                  <span class='sw-sidebar-avatar'>{{p.initials}}</span>
                  <div class='sw-sidebar-participant-info'>
                    <span class='sw-sidebar-participant-name'>{{p.name}}</span>
                    <span class='sw-sidebar-participant-role'>{{p.role}}</span>
                  </div>
                </div>
              {{/each}}
            </div>
          {{/if}}

          {{! Linked cards }}
          <div class='sw-sidebar-section'>
            <div class='sw-sidebar-heading'>Linked Cards</div>
            {{#if @model.listing}}
              <div class='sw-sidebar-fitted-card'>
                {{#if this.isSourceListing}}
                  <span class='sw-source-badge'>
                    <SourceCode class='sw-source-icon' />
                    Source Listing
                  </span>
                {{/if}}
                <@fields.listing @format='fitted' />
              </div>
            {{/if}}
            {{#if @model.prCard}}
              <div class='sw-sidebar-fitted-card'>
                <@fields.prCard @format='fitted' />
              </div>
            {{/if}}
            {{#unless @model.listing}}
              {{#unless @model.prCard}}
                <div class='sw-sidebar-empty'>No cards linked yet</div>
              {{/unless}}
            {{/unless}}
          </div>
        </aside>

      </div>

      <style scoped>
        /* ── Layout ── */
        .sw-layout {
          --c-bg: #ffffff;
          --c-surface: #f8fafc;
          --c-border: #e2e8f0;
          --c-text: #0f172a;
          --c-muted: #64748b;
          --c-success: #10b981;
          --c-danger: #ef4444;
          --c-active: #6366f1;
          --c-neutral: #94a3b8;
          --c-warning: #f5e00b;
          --c-warning-text: #92400e;
          --font:
            ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;

          display: grid;
          grid-template-columns: minmax(0, 1fr) 280px;
          height: 100%;
          width: 100%;
          font-family: var(--font);
          overflow: hidden;
          background: var(--c-bg);
        }

        /* ── Main content ── */
        .sw-main {
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          border-right: 1px solid var(--c-border);
        }

        .sw-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid var(--c-border);
          flex-shrink: 0;
        }
        .sw-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .sw-title {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: var(--c-text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sw-status-pill {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 3px 10px;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .sw-status-pill.success {
          background: rgba(16, 185, 129, 0.12);
          color: var(--c-success);
        }
        .sw-status-pill.danger {
          background: rgba(239, 68, 68, 0.1);
          color: var(--c-danger);
        }
        .sw-status-pill.active {
          background: rgba(99, 102, 241, 0.1);
          color: var(--c-active);
        }
        .sw-status-pill.neutral {
          background: var(--c-surface);
          color: var(--c-muted);
        }

        .sw-submitted-by {
          font-size: 12px;
          color: var(--c-muted);
          flex-shrink: 0;
        }

        /* ── Step tracker ── */
        .sw-steps {
          padding: 28px 24px;
          display: flex;
          flex-direction: column;
        }

        .sw-step {
          display: flex;
          gap: 16px;
          min-height: 80px;
        }
        .sw-step:last-child {
          min-height: auto;
        }

        .sw-step-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex-shrink: 0;
          width: 28px;
        }

        .sw-step-icon {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          position: relative;
        }
        .sw-step-icon.completed {
          background: var(--c-success);
          color: #fff;
        }
        .sw-step-icon.current {
          background: var(--c-active);
          color: #fff;
        }
        .sw-step-icon.blocked {
          background: var(--c-danger);
          color: #fff;
        }
        .sw-step-icon.in-progress {
          background: var(--c-active);
          color: #fff;
        }
        .sw-step-icon.upcoming {
          background: var(--c-surface);
          border: 2px solid var(--c-border);
        }

        .sw-step-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: stepSpin 0.8s linear infinite;
        }

        .sw-step-pulse {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #fff;
          animation: stepPulse 2s ease-in-out infinite;
        }

        .sw-step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--c-border);
        }

        .sw-step-connector {
          flex: 1;
          width: 2px;
          min-height: 20px;
          margin: 4px 0;
        }
        .sw-step-connector.completed {
          background: var(--c-success);
        }
        .sw-step-connector.current {
          background: linear-gradient(
            to bottom,
            var(--c-active),
            var(--c-border)
          );
        }
        .sw-step-connector.in-progress {
          background: linear-gradient(
            to bottom,
            var(--c-active),
            var(--c-border)
          );
        }
        .sw-step-connector.blocked {
          background: linear-gradient(
            to bottom,
            var(--c-danger),
            var(--c-border)
          );
        }
        .sw-step-connector.upcoming {
          background: var(--c-border);
        }

        .sw-step-content {
          flex: 1;
          min-width: 0;
          padding-bottom: 24px;
        }
        .sw-step:last-child .sw-step-content {
          padding-bottom: 0;
        }

        .sw-step-label {
          font-size: 14px;
          font-weight: 600;
          color: var(--c-text);
          margin-bottom: 2px;
        }
        .sw-step.completed .sw-step-label {
          color: var(--c-muted);
        }
        .sw-step.upcoming .sw-step-label {
          color: var(--c-muted);
        }

        .sw-step-description {
          font-size: 12px;
          color: var(--c-muted);
          line-height: 1.4;
        }

        /* ── Step status detail ── */
        .sw-step-status-detail {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.4;
        }
        .sw-step-status-detail.in-progress {
          color: var(--c-active);
        }
        .sw-step-status-detail.blocked {
          color: var(--c-danger);
        }

        .sw-status-spinner-small {
          width: 12px;
          height: 12px;
          border: 2px solid rgba(99, 102, 241, 0.25);
          border-top-color: var(--c-active);
          border-radius: 50%;
          animation: stepSpin 0.8s linear infinite;
          flex-shrink: 0;
        }

        /* ── Step detail cards ── */
        .sw-step-detail {
          margin-top: 10px;
        }

        .sw-fitted-card-container {
          position: relative;
          max-width: 360px;
          height: 180px;
          border-radius: 10px;
          border: 1px solid var(--c-border);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
          margin-top: 15px;
          overflow: visible;
        }

        .sw-fitted-card-container > :not(.sw-source-badge) {
          border-radius: inherit;
          overflow: hidden;
        }

        .sw-source-badge {
          position: absolute;
          top: -10px;
          right: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          background-color: var(--c-warning);
          color: var(--c-warning-text);
          font: 600 var(--boxel-font-sm);
          padding: 3px 10px;
          border-radius: 4px;
          z-index: 15;
          white-space: nowrap;
          letter-spacing: 0.1px;
          text-transform: uppercase;
          font-size: 10px;
          box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2);
          border: none;
        }

        .sw-source-icon {
          width: 10px;
          height: 10px;
          flex-shrink: 0;
        }

        .sw-embedded-card-container {
          max-width: 100%;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--c-border);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
        }

        .sw-lint-errors {
          background: rgba(239, 68, 68, 0.06);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .sw-lint-header {
          font-size: 11px;
          font-weight: 700;
          color: var(--c-danger);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .sw-lint-error-line {
          font-size: 12px;
          font-family: ui-monospace, 'SF Mono', 'Cascadia Code', monospace;
          color: var(--c-text);
          line-height: 1.5;
          padding: 2px 0;
          word-break: break-word;
        }
        .sw-lint-info {
          font-size: 12px;
          color: var(--c-success);
          font-weight: 600;
        }

        /* ── Sidebar ── */
        .sw-sidebar {
          display: flex;
          flex-direction: column;
          background: var(--c-surface);
          overflow-y: auto;
        }

        .sw-progress-section {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px 20px;
          border-bottom: 1px solid var(--c-border);
          background: var(--c-bg);
        }

        .sw-donut {
          --pct: 0;
          --ring: var(--c-neutral);
          --track: #e8ecf4;
          width: 110px;
          height: 110px;
          border-radius: 50%;
          background:
            radial-gradient(closest-side, var(--c-bg) 72%, transparent 74%),
            conic-gradient(var(--ring) calc(var(--pct) * 1%), var(--track) 0);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
        }
        .sw-donut.success {
          --ring: var(--c-success);
        }
        .sw-donut.danger {
          --ring: var(--c-danger);
        }
        .sw-donut.active {
          --ring: var(--c-active);
        }
        .sw-donut.neutral {
          --ring: var(--c-neutral);
        }

        .sw-donut-pct {
          font-size: 20px;
          font-weight: 800;
          color: var(--c-text);
          line-height: 1;
        }
        .sw-donut-label {
          font-size: 10px;
          color: var(--c-muted);
          letter-spacing: 0.04em;
        }

        /* ── Sidebar sections ── */
        .sw-sidebar-section {
          padding: 16px;
          border-bottom: 1px solid var(--c-border);
          background: var(--c-bg);
        }
        .sw-sidebar-heading {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--c-muted);
          margin-bottom: 10px;
        }

        /* ── Sidebar steps ── */
        .sw-sidebar-step {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 0;
        }

        .sw-sidebar-icon {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .sw-sidebar-icon.completed {
          background: var(--c-success);
          color: #fff;
        }
        .sw-sidebar-icon.in-progress {
          background: var(--c-active);
        }
        .sw-sidebar-icon.current {
          background: var(--c-active);
        }
        .sw-sidebar-icon.blocked {
          background: var(--c-danger);
          color: #fff;
        }

        .sw-sidebar-spinner-small {
          width: 8px;
          height: 8px;
          border: 1.5px solid rgba(255, 255, 255, 0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: stepSpin 0.8s linear infinite;
        }
        .sw-sidebar-icon.upcoming {
          border: 2px solid var(--c-border);
        }

        .sw-sidebar-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .sw-sidebar-dot.current {
          background: #fff;
        }
        .sw-sidebar-dot.upcoming {
          background: var(--c-border);
        }

        .sw-sidebar-step-label {
          font-size: 12px;
          color: var(--c-text);
        }
        .sw-sidebar-step.completed .sw-sidebar-step-label {
          color: var(--c-muted);
          text-decoration: line-through;
          opacity: 0.7;
        }
        .sw-sidebar-step.in-progress .sw-sidebar-step-label {
          font-weight: 700;
          color: var(--c-active);
        }
        .sw-sidebar-step.current .sw-sidebar-step-label {
          font-weight: 700;
        }
        .sw-sidebar-step.upcoming .sw-sidebar-step-label {
          color: var(--c-muted);
        }

        /* ── Sidebar participants ── */
        .sw-sidebar-participant {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 0;
        }
        .sw-sidebar-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #1e293b;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .sw-sidebar-participant-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .sw-sidebar-participant-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--c-text);
        }
        .sw-sidebar-participant-role {
          font-size: 11px;
          color: var(--c-muted);
        }

        /* ── Sidebar linked cards ── */
        .sw-sidebar-fitted-card {
          position: relative;
          height: 70px;
          border-radius: 8px;
          border: 1px solid var(--c-border);
          margin-bottom: 6px;
          overflow: visible;
        }

        .sw-sidebar-fitted-card > :not(.sw-source-badge) {
          border-radius: inherit;
          overflow: hidden;
        }
        .sw-sidebar-empty {
          font-size: 12px;
          color: var(--c-muted);
        }

        /* ── Animations ── */
        @keyframes stepSpin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes stepPulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(0.85);
          }
        }

        /* ── Catalog link ── */
        .sw-catalog-link {
          margin-top: 8px;
        }

        /* ── Responsive ── */
        @media (max-width: 800px) {
          .sw-layout {
            grid-template-columns: 1fr;
          }
          .sw-sidebar {
            display: none;
          }
        }
      </style>
    </template>
  };

  // ── Fitted: Compact tile ──

  static fitted = class Fitted extends Component<
    typeof SubmissionWorkflowCard
  > {
    get hasListing() {
      return !!this.args.model.listing;
    }

    get hasPr() {
      return !!this.args.model.prCard;
    }

    get listingName() {
      return this.args.model.listing?.name ?? 'No listing';
    }

    get stepCount() {
      return STEP_DEFINITIONS.length;
    }

    // Simplified progress without live queries for the fitted card
    get basicProgress(): number {
      let completed = 0;
      if (this.hasListing) completed++;
      if (this.hasPr) completed++;
      return Math.round((completed / this.stepCount) * 100);
    }

    get statusLabel(): string {
      if (!this.hasListing) return 'Not Started';
      if (!this.hasPr) return 'Listing Selected';
      return 'PR Created';
    }

    <template>
      <div class='sw-fitted'>
        <div class='sw-fitted-top'>
          <span class='sw-fitted-status'>{{this.statusLabel}}</span>
          <div
            class='sw-fitted-ring'
            style={{htmlSafe (concat '--pct:' this.basicProgress ';')}}
          ></div>
        </div>
        <div class='sw-fitted-title'>{{@model.title}}</div>
        <div class='sw-fitted-subtitle'>{{this.listingName}}</div>
        {{#if @model.submittedBy}}
          <div class='sw-fitted-meta'>
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            ><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' /><circle
                cx='12'
                cy='7'
                r='4'
              /></svg>
            {{@model.submittedBy}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .sw-fitted {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          background: linear-gradient(160deg, #0f172a, #1e293b 55%, #312e81);
          color: #e2e8f0;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          font-family:
            ui-sans-serif,
            system-ui,
            -apple-system,
            'Segoe UI',
            sans-serif;
          overflow: hidden;
        }
        .sw-fitted-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .sw-fitted-status {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 2px 7px;
          border-radius: 4px;
          background: rgba(99, 102, 241, 0.18);
          color: #a5b4fc;
        }
        .sw-fitted-ring {
          --pct: 0;
          --ring-c: #6366f1;
          --track-c: rgba(255, 255, 255, 0.1);
          width: 28px;
          height: 28px;
          border-radius: 50%;
          flex-shrink: 0;
          background:
            radial-gradient(closest-side, #0f172a 64%, transparent 66%),
            conic-gradient(
              var(--ring-c) calc(var(--pct) * 1%),
              var(--track-c) 0
            );
        }
        .sw-fitted-title {
          font-size: 13px;
          font-weight: 700;
          color: #f1f5f9;
          margin-bottom: 2px;
          line-height: 1.35;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sw-fitted-subtitle {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
          margin-bottom: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sw-fitted-meta {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.35);
          margin-top: auto;
        }
      </style>
    </template>
  };

  // ── Embedded: Inline summary ──

  static embedded = class Embedded extends Component<
    typeof SubmissionWorkflowCard
  > {
    get listingName() {
      return this.args.model.listing?.name ?? 'No listing';
    }

    get hasListing() {
      return !!this.args.model.listing;
    }

    get hasPr() {
      return !!this.args.model.prCard;
    }

    get basicProgress(): number {
      let completed = 0;
      if (this.hasListing) completed++;
      if (this.hasPr) completed++;
      return Math.round((completed / STEP_DEFINITIONS.length) * 100);
    }

    <template>
      <div class='sw-embed'>
        <span class='sw-embed-pill'>Submission</span>
        <span class='sw-embed-title'>{{@model.title}}</span>
        <div class='sw-embed-ring-wrap'>
          <div
            class='sw-embed-ring'
            style={{htmlSafe (concat '--pct:' this.basicProgress ';')}}
          ></div>
          <span class='sw-embed-pct'>{{this.basicProgress}}%</span>
        </div>
      </div>

      <style scoped>
        .sw-embed {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: linear-gradient(135deg, #0f172a, #1e293b);
          color: #f1f5f9;
          border-radius: 10px;
          font-family:
            ui-sans-serif,
            system-ui,
            -apple-system,
            sans-serif;
        }
        .sw-embed-pill {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 4px;
          flex-shrink: 0;
          background: rgba(99, 102, 241, 0.18);
          color: #a5b4fc;
        }
        .sw-embed-title {
          font-size: 13px;
          font-weight: 700;
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sw-embed-ring-wrap {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .sw-embed-ring {
          --pct: 0;
          --ring-c: #6366f1;
          --track-c: rgba(255, 255, 255, 0.1);
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background:
            radial-gradient(closest-side, #0f172a 65%, transparent 67%),
            conic-gradient(
              var(--ring-c) calc(var(--pct) * 1%),
              var(--track-c) 0
            );
        }
        .sw-embed-pct {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.5);
        }
      </style>
    </template>
  };
}

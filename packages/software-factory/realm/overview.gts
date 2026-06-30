import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { get } from '@ember/helper';

import {
  type CardContext,
  type FieldsTypeFor,
  type PartialBaseInstanceType,
} from 'https://cardstack.com/base/card-api';

import {
  codeRef,
  realmURL,
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import { ProgressBar } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import BookOpen from '@cardstack/boxel-icons/book-open';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleDashed from '@cardstack/boxel-icons/circle-dashed';
import CircleDot from '@cardstack/boxel-icons/circle-dot';
import Rocket from '@cardstack/boxel-icons/rocket';

import {
  findOptionColor,
  issuePriorityOptions,
  issueStatusOptions,
  issueTypeOptions,
  type Option,
} from './kanban-config.gts';
import { EmptyState } from './empty-state.gts';
import { StatusPill } from './status-pill.gts';
import type { RealmDashboard } from './realm-dashboard.gts';

// @ts-expect-error this is not a CJS file, import.meta is allowed
const importMetaUrl: string = import.meta.url;

// `Validations/` after every agent turn. A `type` filter matches each
// card and its subclasses, so the tab surfaces the whole pipeline.
const VALIDATION_TYPES = [
  codeRef(importMetaUrl, './parse-result', 'ParseResult'),
  codeRef(importMetaUrl, './lint-result', 'LintResult'),
  codeRef(importMetaUrl, './eval-result', 'EvalResult'),
  codeRef(importMetaUrl, './instantiate-result', 'InstantiateResult'),
  codeRef(importMetaUrl, './test-results', 'TestRun'),
];

const KNOWLEDGE_TYPE = codeRef(
  importMetaUrl,
  './knowledge-article',
  'KnowledgeArticle',
);

interface FunnelRow {
  value: string;
  label: string;
  color: string | undefined;
  count: number;
}

type SetupStatus = 'done' | 'active' | 'upcoming';

interface SetupStep {
  label: string;
  description: string;
  status: SetupStatus;
}

interface OverviewSignature {
  Element: HTMLElement;
  Args: {
    model: PartialBaseInstanceType<typeof RealmDashboard>;
    fields: FieldsTypeFor<RealmDashboard>;
    context?: CardContext;
  };
}

// The realm-index Overview as a standalone component so the index card stays a
// thin tab shell. It reads everything off the index card's model and fields,
// which the caller forwards verbatim.
export class Overview extends GlimmerComponent<OverviewSignature> {
  @cached
  get project() {
    return this.args.model.board?.project;
  }

  @cached
  get issues() {
    return this.project?.issues ?? [];
  }

  get knowledge() {
    return this.project?.knowledgeBase ?? [];
  }

  get totalIssues(): number {
    return this.issues.length;
  }

  @cached
  get doneIssues(): number {
    return this.issues.filter((issue) => issue?.status === 'done').length;
  }

  get progressPct(): number {
    if (!this.totalIssues) {
      return 0;
    }
    return Math.round((this.doneIssues / this.totalIssues) * 100);
  }

  countFor(options: Option[], values: (string | undefined)[]): FunnelRow[] {
    return options
      .map((option) => ({
        value: option.value,
        label: option.label,
        color: findOptionColor(options, option.value),
        count: values.filter((value) => value === option.value).length,
      }))
      .filter((row) => row.count > 0);
  }

  @cached
  get statusFunnel(): FunnelRow[] {
    return this.countFor(
      issueStatusOptions,
      this.issues.map((issue) => issue?.status),
    );
  }

  @cached
  get priorityFunnel(): FunnelRow[] {
    return this.countFor(
      issuePriorityOptions,
      this.issues.map((issue) => issue?.priority),
    );
  }

  @cached
  get typeFunnel(): FunnelRow[] {
    return this.countFor(
      issueTypeOptions,
      this.issues.map((issue) => issue?.issueType),
    );
  }

  // The filtered/sorted subsets are computed `linksToMany` fields on the card
  // so the rows can render through `<@fields>`. These getters read those
  // fields, keeping the model side index-aligned with the field side for the
  // per-row decorations.
  get blockedIssues() {
    return this.args.model.blockedIssues ?? [];
  }

  get recentIssues() {
    return this.args.model.recentIssues ?? [];
  }

  get projectObjective(): string | undefined {
    return this.project?.objective;
  }

  @cached
  get validationRealms(): string[] {
    let url = this.args.model[realmURL];
    return url ? [url.href] : [];
  }

  // Validation results link *to* an issue, so to group them we run one
  // query per issue. Each of the five result types has its own `issue`
  // field, so the `issue.id` constraint is scoped per type via `on`. Sort by
  // `createdAt`, a general (type-agnostic) field: a per-type field like `runAt`
  // would need an `on`, which can't span the five types in this `any` filter,
  // and each result card is created when its run completes, so newest-created
  // is newest-run.
  validationQueryForIssue = (
    issueId: string | undefined,
  ): SearchEntryWireQuery => {
    return {
      ...searchEntryWireQueryFromQuery({
        filter: {
          any: VALIDATION_TYPES.map((ref) => ({
            on: ref,
            eq: { 'issue.id': issueId ?? '' },
          })),
        },
        sort: [{ by: 'createdAt', direction: 'desc' }],
      }),
      realms: this.validationRealms,
    };
  };

  // Knowledge articles live in the same realm as the index card. A nested
  // `<@fields.board.project.knowledgeBase>` path can't render them — a
  // `linksToMany` two `linksTo` hops down isn't carried into the field graph —
  // so we surface them as fitted cards via the same search surface the
  // validation widget uses.
  get knowledgeQuery(): SearchEntryWireQuery {
    return {
      ...searchEntryWireQueryFromQuery({
        filter: { type: KNOWLEDGE_TYPE },
      }),
      realms: this.validationRealms,
    };
  }

  get realmName(): string | undefined {
    return this.args.model.cardTitle;
  }

  get setupTitle(): string {
    return `${this.realmName ?? 'Your factory realm'} is getting set up`;
  }

  // Bootstrap roadmap whose statuses are derived from live model state, so it
  // ticks forward on its own as the realm re-indexes: a step is `done` once its
  // signal is present, the first not-yet-done step is `active`, and the rest are
  // `upcoming`. The linked fields these read are reactive, so the panel updates
  // without any polling while the host keeps the card subscribed to its realm.
  @cached
  get setupSteps(): SetupStep[] {
    let steps = [
      {
        label: 'Realm created',
        activeLabel: 'Creating realm…',
        description: 'Your workspace is live and indexing.',
        done: this.validationRealms.length > 0,
      },
      {
        label: 'Bootstrap project & board',
        activeLabel: 'Bootstrapping project & board…',
        description:
          'Reading the brief to set up the project and issue tracker.',
        done: Boolean(this.project),
      },
      {
        label: 'Seed the knowledge base',
        activeLabel: 'Seeding the knowledge base…',
        description: this.knowledge.length
          ? `${this.knowledge.length} knowledge ${
              this.knowledge.length === 1 ? 'article' : 'articles'
            } captured.`
          : 'Capturing architecture, decisions, and runbooks as articles.',
        done: this.knowledge.length > 0,
      },
      {
        label: 'Generate the issue backlog',
        activeLabel: 'Generating the issue backlog…',
        description:
          this.totalIssues > 1
            ? `${this.totalIssues} issues on the board.`
            : 'Breaking the work into issues with priorities and dependencies.',
        done: this.totalIssues > 1,
      },
    ];
    let firstActive = steps.findIndex((step) => !step.done);
    return steps.map(({ label, activeLabel, description, done }, index) => {
      let status: SetupStatus = done
        ? 'done'
        : index === firstActive
          ? 'active'
          : 'upcoming';
      return {
        label: status === 'active' ? activeLabel : label,
        description,
        status,
      };
    });
  }

  // The run is finished setting up once every roadmap step is done; at that
  // point the panel retires and the Overview shows just the live widgets.
  get setupComplete(): boolean {
    return this.setupSteps.every((step) => step.status === 'done');
  }

  statusColor = (status: string | undefined): string | undefined => {
    return findOptionColor(issueStatusOptions, status);
  };

  statusLabel = (status: string | undefined): string => {
    return (
      issueStatusOptions.find((option) => option.value === status)?.label ??
      status ??
      '—'
    );
  };

  <template>
    <div class='overview-panel' data-test-overview ...attributes>
      <div class='overview-content'>
        {{#unless this.setupComplete}}
          <section class='setup-progress {{if this.project "widget"}}'>
            {{#if this.project}}
              <header class='setup-header'>
                <span class='setup-icon'>
                  <Rocket width='18' height='18' aria-hidden='true' />
                </span>
                <h3 class='setup-title'>
                  Setup progress
                </h3>
              </header>
            {{else}}
              <EmptyState
                @icon={{Rocket}}
                @title={{this.setupTitle}}
                @badgeLabel='Bootstrapping'
              >
                <p class='gs-lede'>
                  The factory is running its bootstrap issue. As it works, this
                  Overview fills in with project status, the issue board, the
                  knowledge base, and validation runs.
                </p>
              </EmptyState>
            {{/if}}

            <ol class='gs-steps' data-test-setup-steps>
              {{#each this.setupSteps as |step|}}
                <li
                  class='gs-step'
                  data-status={{step.status}}
                  data-test-setup-step={{step.status}}
                >
                  <span class='gs-step-mark'>
                    {{#if (eq step.status 'done')}}
                      <CircleCheck
                        class='gs-icon done'
                        width='20'
                        height='20'
                        aria-hidden='true'
                      />
                    {{else if (eq step.status 'active')}}
                      <CircleDot
                        class='gs-icon active'
                        width='20'
                        height='20'
                        aria-hidden='true'
                      />
                    {{else}}
                      <CircleDashed
                        class='gs-icon upcoming'
                        width='20'
                        height='20'
                        aria-hidden='true'
                      />
                    {{/if}}
                  </span>
                  <span class='gs-step-body'>
                    <span class='gs-step-label'>{{step.label}}</span>
                    <span class='gs-step-desc'>{{step.description}}</span>
                  </span>
                </li>
              {{/each}}
            </ol>

            {{#unless this.project}}
              <p class='gs-hint'>
                The
                <strong>Board</strong>
                and
                <strong>Artifacts</strong>
                tabs populate as the factory creates cards — switch over any
                time to watch them fill in.
              </p>
            {{/unless}}
          </section>
        {{/unless}}

        {{#if this.project}}
          <section class='kpi-strip'>
            <div class='kpi'>
              <span class='kpi-label'>Project</span>
              <span class='kpi-value' data-test-project-kpi>
                <@fields.project @format='atom' @displayContainer={{false}} />
              </span>
            </div>
            <div class='kpi'>
              <span class='kpi-label'>Status</span>
              <span class='kpi-value' data-test-status-kpi>
                {{#if this.project.projectStatus}}
                  {{this.project.projectStatus}}
                {{else}}
                  Planning
                {{/if}}
              </span>
            </div>
            <div class='kpi'>
              <span class='kpi-label'>Issues</span>
              <span
                class='kpi-value'
                data-test-issues-kpi
              >{{this.totalIssues}}</span>
            </div>
            <div class='kpi'>
              <span class='kpi-label'>Done</span>
              <span
                class='kpi-value'
                data-test-done-kpi
              >{{this.doneIssues}}</span>
            </div>
            <div class='kpi'>
              <span class='kpi-label'>Blocked</span>
              <span
                class='kpi-value'
                data-test-blocked-kpi
              >{{this.blockedIssues.length}}</span>
            </div>
            <div class='kpi'>
              <span class='kpi-label'>Knowledge</span>
              <span
                class='kpi-value'
                data-test-knowledge-kpi
              >{{this.knowledge.length}}</span>
            </div>
          </section>

          <section class='progress-section'>
            <div class='progress-head'>
              <span>Completion</span>
              <span>{{this.progressPct}}%</span>
            </div>
            <ProgressBar @value={{this.doneIssues}} @max={{this.totalIssues}} />
          </section>

          <div class='overview-grid'>
            <section class='widget'>
              <h3 class='widget-title'>By Status</h3>
              <ul class='funnel' data-test-status-funnel>
                {{#each this.statusFunnel as |row|}}
                  <li class='funnel-row' data-test-funnel-row={{row.value}}>
                    <StatusPill @color={{row.color}}>{{row.label}}</StatusPill>
                    <span
                      class='funnel-count'
                      data-test-funnel-count
                    >{{row.count}}</span>
                  </li>
                {{/each}}
              </ul>
            </section>

            <section class='widget'>
              <h3 class='widget-title'>By Priority</h3>
              <ul class='funnel' data-test-priority-funnel>
                {{#each this.priorityFunnel as |row|}}
                  <li class='funnel-row' data-test-funnel-row={{row.value}}>
                    <StatusPill @color={{row.color}}>{{row.label}}</StatusPill>
                    <span
                      class='funnel-count'
                      data-test-funnel-count
                    >{{row.count}}</span>
                  </li>
                {{/each}}
              </ul>
            </section>

            <section class='widget'>
              <h3 class='widget-title'>By Type</h3>
              <ul class='funnel' data-test-type-funnel>
                {{#each this.typeFunnel as |row|}}
                  <li class='funnel-row' data-test-funnel-row={{row.value}}>
                    <StatusPill @color={{row.color}}>{{row.label}}</StatusPill>
                    <span
                      class='funnel-count'
                      data-test-funnel-count
                    >{{row.count}}</span>
                  </li>
                {{/each}}
              </ul>
            </section>
          </div>

          <div class='overview-grid'>
            <section class='widget'>
              <h3 class='widget-title'>
                <CircleAlert
                  class='widget-icon'
                  width='16'
                  height='16'
                  aria-hidden='true'
                />
                Needs Attention
              </h3>
              {{#if this.blockedIssues.length}}
                <ul class='issue-list' data-test-blocked-list>
                  {{#each @fields.blockedIssues as |IssueAtom index|}}
                    {{#let (get this.blockedIssues index) as |issue|}}
                      <li
                        class='issue-row'
                        data-test-blocked-issue={{issue.issueId}}
                      >
                        <span class='issue-id'>{{issue.issueId}}</span>
                        <span class='issue-title'>
                          <IssueAtom
                            @format='atom'
                            @displayContainer={{false}}
                          />
                        </span>
                        {{#if issue.blockedBy.length}}
                          <span class='issue-note'>blocked by
                            {{issue.blockedBy.length}}</span>
                        {{/if}}
                      </li>
                    {{/let}}
                  {{/each}}
                </ul>
              {{else}}
                <p class='empty-state'>Nothing blocked.</p>
              {{/if}}
            </section>

            <section class='widget'>
              <h3 class='widget-title'>Recent Activity</h3>
              {{#if this.recentIssues.length}}
                <ul class='issue-list' data-test-recent-list>
                  {{#each @fields.recentIssues as |IssueAtom index|}}
                    {{#let (get this.recentIssues index) as |issue|}}
                      <li
                        class='issue-row'
                        data-test-recent-issue={{issue.issueId}}
                      >
                        <StatusPill
                          @color={{this.statusColor issue.status}}
                        >{{this.statusLabel issue.status}}</StatusPill>
                        <span class='issue-title'>
                          <IssueAtom
                            @format='atom'
                            @displayContainer={{false}}
                          />
                        </span>
                      </li>
                    {{/let}}
                  {{/each}}
                </ul>
              {{else}}
                <p class='empty-state'>No issues yet.</p>
              {{/if}}
            </section>
          </div>

          {{#if this.projectObjective}}
            <section class='widget'>
              <h3 class='widget-title'>Objective</h3>
              {{this.projectObjective}}
            </section>
          {{/if}}

          <section class='widget'>
            <h3 class='widget-title'>
              <BookOpen
                class='widget-icon'
                width='16'
                height='16'
                aria-hidden='true'
              />
              Knowledge Articles
            </h3>
            {{#if this.validationRealms.length}}
              {{#let
                (component @context.searchResultsComponent)
                as |SearchResults|
              }}
                <SearchResults
                  @query={{this.knowledgeQuery}}
                  @mode='none'
                  as |results|
                >
                  <div class='knowledge-grid'>
                    {{#each results.entries key='id' as |entry|}}
                      <div class='knowledge-cell'>
                        <entry.component />
                      </div>
                    {{else}}
                      {{#if results.isLoading}}
                        <p class='empty-state'>Loading…</p>
                      {{else}}
                        <p class='empty-state'>No knowledge articles yet.</p>
                      {{/if}}
                    {{/each}}
                  </div>
                </SearchResults>
              {{/let}}
            {{else}}
              <p class='empty-state'>Realm not resolved — open this card from
                its realm to see knowledge articles.</p>
            {{/if}}
          </section>

          <section class='widget'>
            <h3 class='widget-title'>Validation Runs</h3>
            {{#if this.validationRealms.length}}
              {{#each this.issues key='id' as |issue|}}
                <div class='validation-group'>
                  <div class='validation-group-head'>
                    <span class='issue-id'>{{issue.issueId}}</span>
                    <span class='issue-title'>{{issue.cardTitle}}</span>
                  </div>
                  {{#let
                    (component @context.searchResultsComponent)
                    as |SearchResults|
                  }}
                    <SearchResults
                      @query={{this.validationQueryForIssue issue.id}}
                      @mode='none'
                      as |results|
                    >
                      <div class='validation-list'>
                        {{#each results.entries key='id' as |entry|}}
                          <div class='validation-row'>
                            <entry.component />
                          </div>
                        {{else}}
                          {{#if results.isLoading}}
                            <p class='validation-empty'>Loading…</p>
                          {{else}}
                            <p class='validation-empty'>No runs.</p>
                          {{/if}}
                        {{/each}}
                      </div>
                    </SearchResults>
                  {{/let}}
                </div>
              {{else}}
                <p class='empty-state'>No issues yet.</p>
              {{/each}}
            {{else}}
              <p class='empty-state'>Realm not resolved — open this card from
                its realm to see validation runs.</p>
            {{/if}}
          </section>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .overview-panel {
        height: 100%;
        overflow-y: auto;
      }
      .overview-content {
        max-width: 75rem;
        width: 100%;
        margin: 0 auto;
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .setup-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
      }
      .setup-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        flex-shrink: 0;
        border-radius: var(--boxel-border-radius-sm);
        background: var(--muted, var(--boxel-100));
      }
      .setup-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        line-height: 1.3;
      }
      .kpi-strip {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: var(--boxel-sp-sm);
      }
      .kpi {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius);
        background: var(--muted, var(--boxel-100));
      }
      .kpi-label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .kpi-value {
        font-size: 1.25rem;
        font-weight: 600;
        text-transform: capitalize;
      }
      .progress-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .progress-head {
        display: flex;
        justify-content: space-between;
        font-size: 0.875rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .overview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: var(--boxel-sp);
      }
      .widget {
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
        background: var(--card, var(--boxel-light));
      }
      .widget-title {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-3xs);
        margin: 0 0 var(--boxel-sp-sm);
        font-size: 0.875rem;
        font-weight: 600;
      }
      .widget-icon {
        color: var(--muted-foreground, var(--boxel-500));
      }
      .funnel,
      .issue-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .knowledge-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .knowledge-cell {
        min-height: 4rem;
      }
      .funnel-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
      }
      .funnel-count {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .issue-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: 0.875rem;
      }
      .issue-id {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .issue-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .issue-note {
        font-size: 0.75rem;
        color: var(--destructive, var(--boxel-danger));
      }
      .validation-group {
        margin-top: var(--boxel-sp-sm);
        padding-top: var(--boxel-sp-sm);
        border-top: 1px solid var(--border, var(--boxel-200));
      }
      .validation-group:first-of-type {
        margin-top: 0;
        padding-top: 0;
        border-top: none;
      }
      .validation-group-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xs);
      }
      .validation-list {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .validation-empty {
        margin: 0;
        font-size: 0.75rem;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .empty-state {
        padding: var(--boxel-sp-xl);
        text-align: center;
        color: var(--muted-foreground, var(--boxel-500));
        font-size: 0.875rem;
      }
      .setup-progress {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        margin-bottom: var(--boxel-sp);
      }
      /* Hero framing while the run has no project yet. */
      .setup-progress:not(.widget) {
        gap: var(--boxel-sp-lg);
        max-width: 42rem;
        width: 100%;
        margin: 0 auto;
        padding: var(--boxel-sp-lg) 0;
      }
      /* Once the Overview is live, the steps ride along as a compact widget; the
         widget supplies the container chrome, so drop the list's own. */
      .setup-progress.widget .gs-steps {
        border: none;
        border-radius: 0;
        background: transparent;
      }
      .setup-progress.widget .gs-step:first-child {
        padding-top: 0;
      }
      .setup-progress.widget .gs-step:last-child {
        padding-bottom: 0;
      }
      .gs-lede {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.5;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .gs-steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius);
        background: var(--card, var(--boxel-light));
        color: var(--card-foreground, var(--boxel-dark));
      }
      .gs-step {
        display: flex;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
      }
      .gs-step + .gs-step {
        border-top: 1px solid var(--border, var(--boxel-200));
      }
      .gs-step-mark {
        display: inline-flex;
        justify-content: center;
        align-items: flex-start;
        width: 1.5rem;
        flex-shrink: 0;
        padding-top: 0.1rem;
      }
      .gs-icon.done,
      .gs-icon.active {
        color: var(--primary-foreground, var(--boxel-dark));
        fill: var(--primary, var(--boxel-highlight));
      }
      .gs-icon.upcoming {
        color: var(--muted-foreground, var(--boxel-400));
      }
      .gs-step-body {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
      }
      .gs-step-label {
        font-weight: 600;
        font-size: 0.9375rem;
      }
      .gs-step[data-status='upcoming'] .gs-step-label {
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .gs-step-desc {
        font-size: 0.8125rem;
        line-height: 1.4;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .gs-hint {
        margin: 0;
        font-size: 0.75rem;
        line-height: 1.5;
        color: var(--card-foreground, var(--boxel-700));
      }
    </style>
  </template>
}

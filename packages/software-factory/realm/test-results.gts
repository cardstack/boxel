import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import enumField from 'https://cardstack.com/base/enum';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Project, Issue } from './darkfactory.gts';
import {
  ResultFittedCard,
  resultDisplayStatus,
  resultRunTitle,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';
import { ResultDetailsSection } from './result-details-section.gts';

import FlaskConical from '@cardstack/boxel-icons/flask-conical';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';
import CircleMinus from '@cardstack/boxel-icons/circle-minus';
import CircleDashed from '@cardstack/boxel-icons/circle-dashed';

export const TestRunStatusField = enumField(StringField, {
  options: [
    { value: 'running', label: 'Running' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
  ],
});

export const TestResultStatusField = enumField(StringField, {
  options: [
    { value: 'pending', label: 'Pending' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
    { value: 'skipped', label: 'Skipped' },
  ],
});

export class TestResultEntry extends FieldDef {
  static displayName = 'Test Result Entry';

  @field testName = contains(StringField);
  @field status = contains(TestResultStatusField);
  @field message = contains(StringField);
  @field stackTrace = contains(StringField);
  @field durationMs = contains(NumberField);

  get statusIcon() {
    switch (this.status) {
      case 'passed':
        return '\u2713';
      case 'failed':
        return '\u2717';
      case 'error':
        return '!';
      case 'skipped':
        return '\u2192';
      case 'pending':
        return '\u2013';
      default:
        return '?';
    }
  }

  static embedded = class Embedded extends Component<typeof TestResultEntry> {
    <template>
      <div class='result-entry'>
        <span
          class='status status-{{@model.status}}'
        >{{@model.statusIcon}}</span>
        <span class='test-name'>{{@model.testName}}</span>
        {{#if @model.durationMs}}
          <span class='duration'>{{@model.durationMs}}ms</span>
        {{/if}}
      </div>
      <style scoped>
        .result-entry {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.85rem;
        }
        .status {
          font-weight: bold;
          width: 1.25rem;
          text-align: center;
        }
        .status-passed {
          color: var(--boxel-green, #16a34a);
        }
        .status-failed {
          color: var(--boxel-red, #dc2626);
        }
        .status-error {
          color: var(--boxel-orange, #ea580c);
        }
        .status-pending {
          color: var(--boxel-400, #9ca3af);
        }
        .status-skipped {
          color: var(--boxel-400, #9ca3af);
          font-style: italic;
        }
        .test-name {
          flex: 1;
        }
        .duration {
          color: var(--boxel-400, #9ca3af);
          font-size: 0.75rem;
        }
      </style>
    </template>
  };
}

export class TestModuleResult extends FieldDef {
  static displayName = 'Test Module Result';

  @field moduleRef = contains(CodeRefField);
  @field results = containsMany(TestResultEntry);

  @field passedCount = contains(NumberField, {
    computeVia: function (this: TestModuleResult) {
      return (this.results ?? []).filter((r) => r.status === 'passed').length;
    },
  });

  @field failedCount = contains(NumberField, {
    computeVia: function (this: TestModuleResult) {
      return (this.results ?? []).filter(
        (r) => r.status === 'failed' || r.status === 'error',
      ).length;
    },
  });

  @field skippedCount = contains(NumberField, {
    computeVia: function (this: TestModuleResult) {
      return (this.results ?? []).filter((r) => r.status === 'skipped').length;
    },
  });

  get moduleName() {
    return this.moduleRef?.module ?? 'default';
  }

  get totalCount() {
    return this.results?.length ?? 0;
  }

  get isComplete() {
    return !(this.results ?? []).some((r) => r.status === 'pending');
  }

  static embedded = class Embedded extends Component<typeof TestModuleResult> {
    <template>
      <div class='module-result'>
        <div class='module-header'>
          <span class='module-name'>{{@model.moduleName}}</span>
          {{#if @model.isComplete}}
            <span class='module-counts'>
              {{@model.passedCount}}/{{@model.totalCount}}
              passed
              {{#if @model.skippedCount}}
                <span class='skipped-label'>
                  ({{@model.skippedCount}}
                  skipped)
                </span>
              {{/if}}
            </span>
          {{else}}
            <span class='module-counts'>running...</span>
          {{/if}}
        </div>
        <div class='module-entries'>
          <@fields.results />
        </div>
      </div>
      <style scoped>
        .module-result {
          margin-bottom: 0.75rem;
        }
        .module-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.25rem 0;
          border-bottom: 1px solid var(--boxel-200, #e5e7eb);
          margin-bottom: 0.25rem;
        }
        .module-name {
          font-weight: 600;
          font-size: 0.85rem;
        }
        .module-counts {
          font-size: 0.8rem;
          color: var(--muted-foreground);
        }
        .skipped-label {
          color: var(--boxel-400, #9ca3af);
          font-style: italic;
        }
        .module-entries {
          padding-left: 0.5rem;
        }
      </style>
    </template>
  };
}

export class TestRun extends CardDef {
  static displayName = 'Test Run';

  @field sequenceNumber = contains(NumberField);
  @field runAt = contains(DateTimeField);
  @field completedAt = contains(DateTimeField);
  @field project = linksTo(() => Project);
  @field issue = linksTo(() => Issue);
  @field status = contains(TestRunStatusField);
  @field durationMs = contains(NumberField);
  @field moduleResults = containsMany(TestModuleResult);
  @field errorMessage = contains(StringField);

  @field passedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.moduleResults ?? []).reduce(
        (sum, sr) => sum + (sr.passedCount ?? 0),
        0,
      );
    },
  });

  @field failedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.moduleResults ?? []).reduce(
        (sum, sr) => sum + (sr.failedCount ?? 0),
        0,
      );
    },
  });

  @field skippedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.moduleResults ?? []).reduce(
        (sum, sr) => sum + (sr.skippedCount ?? 0),
        0,
      );
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: TestRun) {
      let seq = this.sequenceNumber ?? '?';
      let status = this.status ?? 'unknown';
      return `TestRun #${seq} \u2014 ${status}`;
    },
  });

  static fitted = class Fitted extends Component<typeof TestRun> {
    get total() {
      return (
        (this.args.model.passedCount ?? 0) +
        (this.args.model.failedCount ?? 0) +
        (this.args.model.skippedCount ?? 0)
      );
    }

    get displayStatus() {
      return resultDisplayStatus(this.total, this.args.model.status);
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Test Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [
        {
          icon: CircleCheck,
          text: `${m.passedCount}/${this.total} passed`,
          tone: 'clean',
        },
      ];
      if (m.failedCount) {
        items.push({
          icon: CircleX,
          text: `${m.failedCount} failed`,
          tone: 'error',
        });
      }
      if (m.skippedCount) {
        items.push({
          icon: CircleMinus,
          text: `${m.skippedCount} skipped`,
          tone: 'muted',
        });
      }
      return items;
    }

    <template>
      <ResultFittedCard
        @icon={{FlaskConical}}
        @label='Tests'
        @sequenceNumber={{@model.sequenceNumber}}
        @status={{this.displayStatus}}
        @emptyLabel='No Tests'
        @title={{this.titleText}}
        @durationMs={{@model.durationMs}}
        @metaItems={{this.metaItems}}
      >
        <:subtitle>
          {{#if @model.project}}<@fields.project @format='atom' />{{/if}}
        </:subtitle>
      </ResultFittedCard>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof TestRun> {
    get total() {
      return (
        (this.args.model.passedCount ?? 0) +
        (this.args.model.failedCount ?? 0) +
        (this.args.model.skippedCount ?? 0)
      );
    }

    get displayStatus() {
      return resultDisplayStatus(this.total, this.args.model.status);
    }

    get titleText() {
      return resultRunTitle('Test', this.args.model.sequenceNumber);
    }

    moduleHasFailures = (module: TestModuleResult) => module.failedCount;

    <template>
      <ResultIsolatedCard
        @title={{this.titleText}}
        @status={{this.displayStatus}}
        @emptyLabel='No Tests'
        @durationMs={{@model.durationMs}}
        @runAt={{@model.runAt}}
        @completedAt={{@model.completedAt}}
        @hasProject={{@model.project}}
        @hasIssue={{@model.issue}}
        @hasError={{@model.errorMessage}}
      >
        <:summary>
          <span>{{@model.passedCount}}/{{this.total}}
            passed{{#if @model.skippedCount}}
              <span class='skipped'>({{@model.skippedCount}} skipped)</span>
            {{/if}}</span>
        </:summary>
        <:project><@fields.project @format='embedded' /></:project>
        <:issue><@fields.issue @format='embedded' /></:issue>
        <:error>{{@model.errorMessage}}</:error>
        <:details>
          <ResultDetailsSection
            @sectionTitle='Test Results'
            @items={{@model.moduleResults}}
            @hasErrors={{this.moduleHasFailures}}
          >
            <:header as |moduleResult|>
              <span class='detail-group-name'>{{moduleResult.moduleName}}</span>
              {{#if moduleResult.isComplete}}
                <span
                  class='group-status
                    {{if
                      moduleResult.failedCount
                      "errors"
                      (if moduleResult.passedCount "clean" "muted")
                    }}'
                >
                  {{#if moduleResult.failedCount}}
                    {{moduleResult.passedCount}}
                    passed,
                    {{moduleResult.failedCount}}
                    failed
                  {{else}}
                    {{moduleResult.passedCount}}/{{moduleResult.totalCount}}
                    passed
                  {{/if}}
                  {{#if moduleResult.skippedCount}}
                    ({{moduleResult.skippedCount}}
                    skipped)
                  {{/if}}
                </span>
              {{else}}
                <span class='group-status running'>running…</span>
              {{/if}}
            </:header>
            <:body as |moduleResult|>
              <div class='test-rows'>
                {{#each moduleResult.results as |result|}}
                  <div class='test-row'>
                    <div class='test-row-main'>
                      {{#if (eq result.status 'passed')}}
                        <CircleCheck
                          class='test-icon icon-passed'
                          width='14'
                          height='14'
                          aria-label='passed'
                        />
                      {{else if (eq result.status 'failed')}}
                        <CircleX
                          class='test-icon icon-failed'
                          width='14'
                          height='14'
                          aria-label='failed'
                        />
                      {{else if (eq result.status 'error')}}
                        <CircleAlert
                          class='test-icon icon-error'
                          width='14'
                          height='14'
                          aria-label='error'
                        />
                      {{else if (eq result.status 'skipped')}}
                        <CircleMinus
                          class='test-icon icon-skipped'
                          width='14'
                          height='14'
                          aria-label='skipped'
                        />
                      {{else}}
                        <CircleDashed
                          class='test-icon icon-pending'
                          width='14'
                          height='14'
                          aria-label='pending'
                        />
                      {{/if}}
                      <span class='test-name'>{{result.testName}}</span>
                      {{#if result.durationMs}}
                        <span
                          class='test-duration'
                        >{{result.durationMs}}ms</span>
                      {{/if}}
                    </div>
                    {{#if result.message}}
                      <pre class='failure-message'>{{result.message}}</pre>
                    {{/if}}
                    {{#if result.stackTrace}}
                      <pre class='failure-stack'>{{result.stackTrace}}</pre>
                    {{/if}}
                  </div>
                {{/each}}
              </div>
            </:body>
          </ResultDetailsSection>
        </:details>
      </ResultIsolatedCard>
      <style scoped>
        .skipped {
          font-style: italic;
        }
        .detail-group-name {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          word-break: break-all;
        }
        .group-status {
          flex-shrink: 0;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--muted-foreground, var(--boxel-500));
          text-transform: uppercase;
        }
        .group-status.clean {
          color: oklch(60% 0.17 150);
        }
        .group-status.errors {
          color: oklch(55% 0.22 25);
        }
        .group-status.running {
          color: oklch(60% 0.16 250);
        }
        .test-rows {
          display: grid;
          gap: var(--boxel-sp-4xs);
        }
        .test-row-main {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
        }
        .test-icon {
          flex-shrink: 0;
        }
        .icon-passed {
          color: oklch(60% 0.17 150);
        }
        .icon-failed {
          color: oklch(55% 0.22 25);
        }
        .icon-error {
          color: oklch(68% 0.17 55);
        }
        .icon-skipped,
        .icon-pending {
          color: var(--muted-foreground, var(--boxel-500));
        }
        .test-name {
          flex: 1;
        }
        .test-duration {
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-500));
          font-size: var(--boxel-font-size-xs);
        }
        .failure-message,
        .failure-stack {
          margin: var(--boxel-sp-4xs) 0 var(--boxel-sp-4xs) var(--boxel-sp-lg);
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: var(--boxel-font-size-xs);
          white-space: pre-wrap;
          overflow-x: auto;
          max-width: 100%;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .failure-stack {
          opacity: 0.7;
        }
      </style>
    </template>
  };
}

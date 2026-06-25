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
import { Project, Issue } from './darkfactory.gts';

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
              {{#if this.args.model.skippedCount}}
                <span class='skipped-label'>
                  ({{this.args.model.skippedCount}}
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

  @field title = contains(StringField, {
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
      if (this.total === 0 && this.args.model.status === 'passed') {
        return 'empty';
      }
      return this.args.model.status;
    }

    <template>
      <div class='test-run compact'>
        <div class='header'>
          <strong>#{{@model.sequenceNumber}}</strong>
          <span
            class='status status-{{this.displayStatus}}'
          >{{this.displayStatus}}</span>
        </div>
        {{#if @model.issue}}
          <div class='issue-name'>{{@model.issue.summary}}</div>
        {{/if}}
        <div class='counts'>
          {{@model.passedCount}}/{{this.total}}
          passed
          {{#if @model.skippedCount}}
            <span class='skipped-label'>
              ({{@model.skippedCount}}
              skipped)
            </span>
          {{/if}}
          {{#if @model.durationMs}}
            <span class='duration'>{{@model.durationMs}}ms</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .test-run {
          display: grid;
          gap: 0.25rem;
        }
        .compact {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .status {
          font-size: 0.75rem;
          text-transform: uppercase;
          font-weight: 600;
          padding: 0.125rem 0.5rem;
          border-radius: 0.25rem;
        }
        .status-passed {
          color: var(--boxel-green, #16a34a);
          background: #f0fdf4;
        }
        .status-failed {
          color: var(--boxel-red, #dc2626);
          background: #fef2f2;
        }
        .status-error {
          color: var(--boxel-orange, #ea580c);
          background: #fff7ed;
        }
        .status-running {
          color: var(--boxel-blue, #2563eb);
          background: #eff6ff;
        }
        .status-empty {
          color: var(--boxel-400, #9ca3af);
          background: #f9fafb;
        }
        .issue-name {
          font-size: 0.8rem;
          color: var(--muted-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .counts {
          font-size: 0.85rem;
          color: var(--muted-foreground);
        }
        .skipped-label {
          color: var(--boxel-400, #9ca3af);
          font-style: italic;
        }
        .duration {
          margin-left: 0.5rem;
          font-size: 0.75rem;
        }
      </style>
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
      if (this.total === 0 && this.args.model.status === 'passed') {
        return 'empty';
      }
      return this.args.model.status;
    }

    <template>
      <article class='surface'>
        <header>
          <div class='header-row'>
            <strong>TestRun #{{@model.sequenceNumber}}</strong>
            <span
              class='status status-{{this.displayStatus}}'
            >{{this.displayStatus}}</span>
          </div>
          <div class='summary'>
            {{@model.passedCount}}/{{this.total}}
            passed
            {{#if @model.skippedCount}}
              <span class='skipped-label'>
                ({{@model.skippedCount}}
                skipped)
              </span>
            {{/if}}
            {{#if @model.durationMs}}
              in
              {{@model.durationMs}}ms
            {{/if}}
          </div>
        </header>

        {{#if @model.project}}
          <section>
            <h2>Project</h2>
            <div class='linked-card'>
              <@fields.project @format='embedded' />
            </div>
          </section>
        {{/if}}

        {{#if @model.issue}}
          <section>
            <h2>Issue</h2>
            <div class='linked-card'>
              <@fields.issue @format='embedded' />
            </div>
          </section>
        {{/if}}

        {{#if @model.errorMessage}}
          <section>
            <h2>Error</h2>
            <p class='error-message'>{{@model.errorMessage}}</p>
          </section>
        {{/if}}

        {{#if @model.moduleResults.length}}
          <section>
            <h2>Test Results</h2>
            {{#each @model.moduleResults as |moduleResult|}}
              <div
                class='module-group
                  {{if moduleResult.failedCount "module-has-failures"}}'
              >
                <div class='module-group-header'>
                  <span
                    class='module-group-name'
                  >{{moduleResult.moduleName}}</span>
                  {{#if moduleResult.isComplete}}
                    <span
                      class='module-group-counts
                        {{if
                          moduleResult.failedCount
                          "has-failures"
                          (if moduleResult.passedCount "has-passes" "empty")
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
                        <span class='skipped-label'>
                          ({{moduleResult.skippedCount}}
                          skipped)
                        </span>
                      {{/if}}
                    </span>
                  {{else}}
                    <span class='module-group-counts running'>running...</span>
                  {{/if}}
                </div>
                <div class='module-group-tests'>
                  {{#each moduleResult.results as |result|}}
                    <div class='test-item'>
                      <div class='test-item-row'>
                        <span
                          class='test-status-icon status-{{result.status}}'
                          role='img'
                          aria-label='{{result.status}}'
                        >{{result.statusIcon}}</span>
                        <span class='test-item-name'>{{result.testName}}</span>
                        {{#if result.durationMs}}
                          <span
                            class='test-item-duration'
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
              </div>
            {{/each}}
          </section>
        {{/if}}
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
          display: grid;
          gap: 1rem;
        }
        .linked-card {
          margin-bottom: 0.5rem;
        }
        .header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .status {
          font-size: 0.75rem;
          text-transform: uppercase;
          font-weight: 600;
          padding: 0.125rem 0.5rem;
          border-radius: 0.25rem;
        }
        .status-passed {
          color: var(--boxel-green, #16a34a);
          background: #f0fdf4;
        }
        .status-failed {
          color: var(--boxel-red, #dc2626);
          background: #fef2f2;
        }
        .status-error {
          color: var(--boxel-orange, #ea580c);
          background: #fff7ed;
        }
        .status-running {
          color: var(--boxel-blue, #2563eb);
          background: #eff6ff;
        }
        .status-empty {
          color: var(--boxel-400, #9ca3af);
          background: #f9fafb;
        }
        .summary {
          font-size: 0.9rem;
          color: var(--muted-foreground);
        }
        .skipped-label {
          color: var(--boxel-400, #9ca3af);
          font-style: italic;
        }
        .error-message {
          color: var(--boxel-red, #dc2626);
          font-family: monospace;
          font-size: 0.85rem;
          white-space: pre-wrap;
        }
        .module-group {
          border: 1px solid var(--boxel-200, #e5e7eb);
          border-radius: 0.5rem;
          padding: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .module-has-failures {
          border-color: var(--boxel-red, #dc2626);
        }
        .module-group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--boxel-200, #e5e7eb);
          margin-bottom: 0.5rem;
        }
        .module-group-name {
          font-weight: 600;
          font-size: 0.9rem;
        }
        .module-group-counts {
          font-size: 0.8rem;
          color: var(--boxel-400, #9ca3af);
        }
        .module-group-counts.has-passes {
          color: var(--boxel-green, #16a34a);
        }
        .module-group-counts.has-failures {
          color: var(--boxel-red, #dc2626);
        }
        .module-group-counts.running {
          color: var(--boxel-blue, #2563eb);
        }
        .module-group-tests {
          display: grid;
          gap: 0.25rem;
        }
        .test-item-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.85rem;
        }
        .test-status-icon {
          font-weight: bold;
          width: 1.25rem;
          text-align: center;
          flex-shrink: 0;
        }
        .test-status-icon.status-passed {
          color: var(--boxel-green, #16a34a);
        }
        .test-status-icon.status-failed {
          color: var(--boxel-red, #dc2626);
        }
        .test-status-icon.status-error {
          color: var(--boxel-orange, #ea580c);
        }
        .test-status-icon.status-pending {
          color: var(--boxel-400, #9ca3af);
        }
        .test-status-icon.status-skipped {
          color: var(--boxel-400, #9ca3af);
          font-style: italic;
        }
        .test-item-name {
          flex: 1;
        }
        .test-item-duration {
          color: var(--boxel-400, #9ca3af);
          font-size: 0.75rem;
        }
        .failure-message,
        .failure-stack {
          font-size: 0.8rem;
          font-family: monospace;
          white-space: pre-wrap;
          overflow-x: auto;
          max-width: 100%;
          margin: 0.25rem 0 0.25rem 1.75rem;
          color: var(--muted-foreground);
        }
        .failure-stack {
          font-size: 0.75rem;
          opacity: 0.7;
        }
      </style>
    </template>
  };
}

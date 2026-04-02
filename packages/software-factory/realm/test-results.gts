import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateTimeField from '@cardstack/base/datetime';
import CodeRefField from '@cardstack/base/code-ref';
import enumField from '@cardstack/base/enum';
import { Project, Ticket } from './darkfactory';

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
  ],
});

export class TestResultEntry extends FieldDef {
  static displayName = 'Test Result Entry';

  @field testName = contains(StringField);
  @field status = contains(TestResultStatusField);
  @field message = contains(StringField);
  @field stackTrace = contains(StringField);
  @field durationMs = contains(NumberField);

  static embedded = class Embedded extends Component<typeof TestResultEntry> {
    get statusIcon() {
      switch (this.args.model.status) {
        case 'passed':
          return '\u2713';
        case 'failed':
          return '\u2717';
        case 'error':
          return '!';
        case 'pending':
          return '\u2013';
        default:
          return '?';
      }
    }

    <template>
      <div class='result-entry'>
        <span class='status status-{{@model.status}}'>{{this.statusIcon}}</span>
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

export class SpecResult extends FieldDef {
  static displayName = 'Spec Result';

  @field specRef = contains(CodeRefField);
  @field results = containsMany(TestResultEntry);

  @field passedCount = contains(NumberField, {
    computeVia: function (this: SpecResult) {
      return (this.results ?? []).filter((r) => r.status === 'passed').length;
    },
  });

  @field failedCount = contains(NumberField, {
    computeVia: function (this: SpecResult) {
      return (this.results ?? []).filter(
        (r) => r.status === 'failed' || r.status === 'error',
      ).length;
    },
  });

  get specName() {
    return this.specRef?.module ?? 'default';
  }

  static embedded = class Embedded extends Component<typeof SpecResult> {
    get total() {
      return this.args.model.results?.length ?? 0;
    }

    get isComplete() {
      return !(this.args.model.results ?? []).some(
        (r) => r.status === 'pending',
      );
    }

    <template>
      <div class='spec-result'>
        <div class='spec-header'>
          <span class='spec-name'>{{this.args.model.specName}}</span>
          {{#if this.isComplete}}
            <span class='spec-counts'>
              {{this.args.model.passedCount}}/{{this.total}}
              passed
            </span>
          {{else}}
            <span class='spec-counts'>running...</span>
          {{/if}}
        </div>
        <div class='spec-entries'>
          <@fields.results />
        </div>
      </div>
      <style scoped>
        .spec-result {
          margin-bottom: 0.75rem;
        }
        .spec-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.25rem 0;
          border-bottom: 1px solid var(--boxel-200, #e5e7eb);
          margin-bottom: 0.25rem;
        }
        .spec-name {
          font-weight: 600;
          font-size: 0.85rem;
        }
        .spec-counts {
          font-size: 0.8rem;
          color: var(--muted-foreground);
        }
        .spec-entries {
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
  @field ticket = linksTo(() => Ticket);
  @field status = contains(TestRunStatusField);
  @field durationMs = contains(NumberField);
  @field specResults = containsMany(SpecResult);
  @field errorMessage = contains(StringField);

  @field passedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.specResults ?? []).reduce(
        (sum, sr) => sum + (sr.passedCount ?? 0),
        0,
      );
    },
  });

  @field failedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.specResults ?? []).reduce(
        (sum, sr) => sum + (sr.failedCount ?? 0),
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
        (this.args.model.passedCount ?? 0) + (this.args.model.failedCount ?? 0)
      );
    }

    <template>
      <div class='test-run compact'>
        <div class='header'>
          <strong>#{{@model.sequenceNumber}}</strong>
          <span class='status status-{{@model.status}}'>{{@model.status}}</span>
        </div>
        <div class='counts'>
          {{@model.passedCount}}/{{this.total}}
          passed
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
        .counts {
          font-size: 0.85rem;
          color: var(--muted-foreground);
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
        (this.args.model.passedCount ?? 0) + (this.args.model.failedCount ?? 0)
      );
    }

    get failedResults() {
      return (this.args.model.specResults ?? []).flatMap((sr) =>
        (sr.results ?? []).filter(
          (r) => r.status === 'failed' || r.status === 'error',
        ),
      );
    }

    <template>
      <article class='surface'>
        <header>
          <div class='header-row'>
            <strong>TestRun #{{@model.sequenceNumber}}</strong>
            <span
              class='status status-{{@model.status}}'
            >{{@model.status}}</span>
          </div>
          <div class='summary'>
            {{@model.passedCount}}/{{this.total}}
            passed
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

        {{#if @model.ticket}}
          <section>
            <h2>Ticket</h2>
            <div class='linked-card'>
              <@fields.ticket @format='embedded' />
            </div>
          </section>
        {{/if}}

        {{#if @model.errorMessage}}
          <section>
            <h2>Error</h2>
            <p class='error-message'>{{@model.errorMessage}}</p>
          </section>
        {{/if}}

        {{#if this.failedResults.length}}
          <section>
            <h2>Failures</h2>
            {{#each this.failedResults as |result|}}
              <div class='failure'>
                <div class='failure-name'>{{result.testName}}</div>
                {{#if result.message}}
                  <pre class='failure-message'>{{result.message}}</pre>
                {{/if}}
                {{#if result.stackTrace}}
                  <pre class='failure-stack'>{{result.stackTrace}}</pre>
                {{/if}}
              </div>
            {{/each}}
          </section>
        {{/if}}

        {{#if @model.specResults.length}}
          <section>
            <h2>Results by Spec</h2>
            <@fields.specResults />
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
        .summary {
          font-size: 0.9rem;
          color: var(--muted-foreground);
        }
        .error-message {
          color: var(--boxel-red, #dc2626);
          font-family: monospace;
          font-size: 0.85rem;
          white-space: pre-wrap;
        }
        .failure {
          border-left: 3px solid var(--boxel-red, #dc2626);
          padding-left: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .failure-name {
          font-weight: 600;
          margin-bottom: 0.25rem;
        }
        .failure-message,
        .failure-stack {
          font-size: 0.8rem;
          font-family: monospace;
          white-space: pre-wrap;
          overflow-x: auto;
          max-width: 100%;
          margin: 0.25rem 0;
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

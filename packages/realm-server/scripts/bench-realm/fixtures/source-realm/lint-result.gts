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
import enumField from 'https://cardstack.com/base/enum';
import { Project, Issue } from './darkfactory';

export const LintResultStatusField = enumField(StringField, {
  options: [
    { value: 'running', label: 'Running' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
  ],
});

export const LintViolationSeverityField = enumField(StringField, {
  options: [
    { value: 'error', label: 'Error' },
    { value: 'warning', label: 'Warning' },
  ],
});

export class LintViolation extends FieldDef {
  static displayName = 'Lint Violation';

  @field rule = contains(StringField);
  @field file = contains(StringField);
  @field line = contains(NumberField);
  @field column = contains(NumberField);
  @field message = contains(StringField);
  @field severity = contains(LintViolationSeverityField);

  get severityIcon() {
    switch (this.severity) {
      case 'error':
        return '\u2717';
      case 'warning':
        return '\u26A0';
      default:
        return '?';
    }
  }

  static embedded = class Embedded extends Component<typeof LintViolation> {
    <template>
      <div class='violation-entry'>
        <span
          class='severity severity-{{@model.severity}}'
        >{{@model.severityIcon}}</span>
        <span class='location'>{{@model.file}}:{{@model.line}}</span>
        <span class='message'>{{@model.message}}</span>
        {{#if @model.rule}}
          <span class='rule'>[{{@model.rule}}]</span>
        {{/if}}
      </div>
      <style scoped>
        .violation-entry {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.85rem;
        }
        .severity {
          font-weight: bold;
          width: 1.25rem;
          text-align: center;
          flex-shrink: 0;
        }
        .severity-error {
          color: var(--boxel-red, #dc2626);
        }
        .severity-warning {
          color: var(--boxel-orange, #ea580c);
        }
        .location {
          color: var(--muted-foreground);
          font-family: monospace;
          font-size: 0.8rem;
          flex-shrink: 0;
        }
        .message {
          flex: 1;
        }
        .rule {
          color: var(--boxel-400, #9ca3af);
          font-size: 0.75rem;
          flex-shrink: 0;
        }
      </style>
    </template>
  };
}

export class LintFileResult extends FieldDef {
  static displayName = 'Lint File Result';

  @field file = contains(StringField);
  @field violations = containsMany(LintViolation);

  @field errorCount = contains(NumberField, {
    computeVia: function (this: LintFileResult) {
      return (this.violations ?? []).filter((v) => v.severity === 'error')
        .length;
    },
  });

  @field warningCount = contains(NumberField, {
    computeVia: function (this: LintFileResult) {
      return (this.violations ?? []).filter((v) => v.severity === 'warning')
        .length;
    },
  });

  get passed() {
    return (this.errorCount ?? 0) === 0;
  }

  get totalCount() {
    return this.violations?.length ?? 0;
  }

  static embedded = class Embedded extends Component<typeof LintFileResult> {
    <template>
      <div class='file-result'>
        <div class='file-header'>
          <span class='file-name'>{{@model.file}}</span>
          {{#if @model.passed}}
            <span class='file-status passed'>clean</span>
          {{else}}
            <span class='file-status failed'>
              {{@model.errorCount}}
              error(s)
              {{#if @model.warningCount}}
                ,
                {{@model.warningCount}}
                warning(s)
              {{/if}}
            </span>
          {{/if}}
        </div>
        {{#if @model.totalCount}}
          <div class='file-violations'>
            <@fields.violations />
          </div>
        {{/if}}
      </div>
      <style scoped>
        .file-result {
          margin-bottom: 0.75rem;
        }
        .file-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.25rem 0;
          border-bottom: 1px solid var(--boxel-200, #e5e7eb);
          margin-bottom: 0.25rem;
        }
        .file-name {
          font-weight: 600;
          font-size: 0.85rem;
          font-family: monospace;
        }
        .file-status {
          font-size: 0.8rem;
        }
        .file-status.passed {
          color: var(--boxel-green, #16a34a);
        }
        .file-status.failed {
          color: var(--boxel-red, #dc2626);
        }
        .file-violations {
          padding-left: 0.5rem;
        }
      </style>
    </template>
  };
}

export class LintResult extends CardDef {
  static displayName = 'Lint Result';

  @field sequenceNumber = contains(NumberField);
  @field runAt = contains(DateTimeField);
  @field completedAt = contains(DateTimeField);
  @field project = linksTo(() => Project);
  @field issue = linksTo(() => Issue);
  @field status = contains(LintResultStatusField);
  @field durationMs = contains(NumberField);
  @field fileResults = containsMany(LintFileResult);
  @field errorMessage = contains(StringField);

  @field totalErrors = contains(NumberField, {
    computeVia: function (this: LintResult) {
      return (this.fileResults ?? []).reduce(
        (sum, fr) => sum + (fr.errorCount ?? 0),
        0,
      );
    },
  });

  @field totalWarnings = contains(NumberField, {
    computeVia: function (this: LintResult) {
      return (this.fileResults ?? []).reduce(
        (sum, fr) => sum + (fr.warningCount ?? 0),
        0,
      );
    },
  });

  @field filesChecked = contains(NumberField, {
    computeVia: function (this: LintResult) {
      return this.fileResults?.length ?? 0;
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: LintResult) {
      let seq = this.sequenceNumber ?? '?';
      let status = this.status ?? 'unknown';
      return `LintResult #${seq} \u2014 ${status}`;
    },
  });

  get filesWithErrors() {
    return (this.fileResults ?? []).filter((fr) => !fr.passed).length;
  }

  get filesClean() {
    return (this.filesChecked ?? 0) - this.filesWithErrors;
  }

  static fitted = class Fitted extends Component<typeof LintResult> {
    get displayStatus() {
      if (
        (this.args.model.filesChecked ?? 0) === 0 &&
        this.args.model.status === 'passed'
      ) {
        return 'empty';
      }
      return this.args.model.status;
    }

    <template>
      <div class='lint-result compact'>
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
          {{@model.filesClean}}/{{@model.filesChecked}}
          files clean
          {{#if @model.totalErrors}}
            <span class='error-label'>
              ({{@model.totalErrors}}
              error(s))
            </span>
          {{/if}}
          {{#if @model.durationMs}}
            <span class='duration'>{{@model.durationMs}}ms</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .lint-result {
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
        .error-label {
          color: var(--boxel-red, #dc2626);
        }
        .duration {
          margin-left: 0.5rem;
          font-size: 0.75rem;
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof LintResult> {
    get displayStatus() {
      if (
        (this.args.model.filesChecked ?? 0) === 0 &&
        this.args.model.status === 'passed'
      ) {
        return 'empty';
      }
      return this.args.model.status;
    }

    <template>
      <article class='surface'>
        <header>
          <div class='header-row'>
            <strong>LintResult #{{@model.sequenceNumber}}</strong>
            <span
              class='status status-{{this.displayStatus}}'
            >{{this.displayStatus}}</span>
          </div>
          <div class='summary'>
            {{@model.filesClean}}/{{@model.filesChecked}}
            files clean
            {{#if @model.totalErrors}}
              ,
              {{@model.totalErrors}}
              error(s)
            {{/if}}
            {{#if @model.totalWarnings}}
              ,
              {{@model.totalWarnings}}
              warning(s)
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

        {{#if @model.fileResults.length}}
          <section>
            <h2>File Results</h2>
            {{#each @model.fileResults as |fileResult|}}
              <div
                class='file-group
                  {{unless fileResult.passed "file-has-errors"}}'
              >
                <div class='file-group-header'>
                  <span class='file-group-name'>{{fileResult.file}}</span>
                  {{#if fileResult.passed}}
                    <span class='file-group-status has-passes'>clean</span>
                  {{else}}
                    <span class='file-group-status has-errors'>
                      {{fileResult.errorCount}}
                      error(s)
                      {{#if fileResult.warningCount}}
                        ,
                        {{fileResult.warningCount}}
                        warning(s)
                      {{/if}}
                    </span>
                  {{/if}}
                </div>
                {{#if fileResult.totalCount}}
                  <div class='file-group-violations'>
                    {{#each fileResult.violations as |violation|}}
                      <div class='violation-item'>
                        <div class='violation-item-row'>
                          <span
                            class='violation-severity severity-{{violation.severity}}'
                            role='img'
                            aria-label='{{violation.severity}}'
                          >{{violation.severityIcon}}</span>
                          <span
                            class='violation-location'
                          >{{violation.line}}:{{violation.column}}</span>
                          <span
                            class='violation-message'
                          >{{violation.message}}</span>
                          {{#if violation.rule}}
                            <span
                              class='violation-rule'
                            >[{{violation.rule}}]</span>
                          {{/if}}
                        </div>
                      </div>
                    {{/each}}
                  </div>
                {{/if}}
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
        .error-message {
          color: var(--boxel-red, #dc2626);
          font-family: monospace;
          font-size: 0.85rem;
          white-space: pre-wrap;
        }
        .file-group {
          border: 1px solid var(--boxel-200, #e5e7eb);
          border-radius: 0.5rem;
          padding: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .file-has-errors {
          border-color: var(--boxel-red, #dc2626);
        }
        .file-group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--boxel-200, #e5e7eb);
          margin-bottom: 0.5rem;
        }
        .file-group-name {
          font-weight: 600;
          font-size: 0.9rem;
          font-family: monospace;
        }
        .file-group-status {
          font-size: 0.8rem;
          color: var(--boxel-400, #9ca3af);
        }
        .file-group-status.has-passes {
          color: var(--boxel-green, #16a34a);
        }
        .file-group-status.has-errors {
          color: var(--boxel-red, #dc2626);
        }
        .file-group-violations {
          display: grid;
          gap: 0.25rem;
        }
        .violation-item-row {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.85rem;
        }
        .violation-severity {
          font-weight: bold;
          width: 1.25rem;
          text-align: center;
          flex-shrink: 0;
        }
        .violation-severity.severity-error {
          color: var(--boxel-red, #dc2626);
        }
        .violation-severity.severity-warning {
          color: var(--boxel-orange, #ea580c);
        }
        .violation-location {
          color: var(--muted-foreground);
          font-family: monospace;
          font-size: 0.8rem;
          flex-shrink: 0;
        }
        .violation-message {
          flex: 1;
        }
        .violation-rule {
          color: var(--boxel-400, #9ca3af);
          font-size: 0.75rem;
          flex-shrink: 0;
        }
      </style>
    </template>
  };
}

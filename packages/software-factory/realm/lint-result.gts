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
import { eq } from '@cardstack/boxel-ui/helpers';
import { Project, Issue } from './darkfactory.gts';
import {
  ResultFittedCard,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';

import ListChecks from '@cardstack/boxel-icons/list-checks';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';

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

  @field cardTitle = contains(StringField, {
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

    get titleText() {
      return this.args.model.issue?.summary ?? 'Lint Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [
        {
          icon: CircleCheck,
          text: `${m.filesClean}/${m.filesChecked} clean`,
          tone: 'clean',
        },
      ];
      if (m.totalErrors) {
        items.push({
          icon: CircleX,
          text: `${m.totalErrors} error(s)`,
          tone: 'error',
        });
      }
      if (m.totalWarnings) {
        items.push({
          icon: CircleAlert,
          text: `${m.totalWarnings} warning(s)`,
          tone: 'warning',
        });
      }
      return items;
    }

    <template>
      <ResultFittedCard
        @icon={{ListChecks}}
        @label='Lint'
        @sequenceNumber={{@model.sequenceNumber}}
        @status={{this.displayStatus}}
        @emptyLabel='No Files'
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

    get titleText() {
      return `Lint Run #${this.args.model.sequenceNumber ?? '?'}`;
    }

    <template>
      <ResultIsolatedCard
        @title={{this.titleText}}
        @status={{this.displayStatus}}
        @emptyLabel='No Files'
        @durationMs={{@model.durationMs}}
        @hasProject={{@model.project}}
        @hasIssue={{@model.issue}}
        @hasError={{@model.errorMessage}}
      >
        <:summary>
          <span>{{@model.filesClean}}/{{@model.filesChecked}}
            files clean{{#if @model.totalErrors}},
              {{@model.totalErrors}}
              error(s){{/if}}{{#if @model.totalWarnings}},
              {{@model.totalWarnings}}
              warning(s){{/if}}</span>
        </:summary>
        <:project><@fields.project @format='embedded' /></:project>
        <:issue><@fields.issue @format='embedded' /></:issue>
        <:error>{{@model.errorMessage}}</:error>
        <:details>
          {{#if @model.fileResults.length}}
            <section class='detail-section'>
              <h2>File Results</h2>
              <div class='detail-groups'>
                {{#each @model.fileResults as |fileResult|}}
                  <div
                    class='detail-group
                      {{unless fileResult.passed "has-errors"}}'
                  >
                    <div class='detail-group-header'>
                      <span class='detail-group-name'>{{fileResult.file}}</span>
                      {{#if fileResult.passed}}
                        <span class='group-status clean'>clean</span>
                      {{else}}
                        <span class='group-status errors'>
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
                      <div class='violation-rows'>
                        {{#each fileResult.violations as |violation|}}
                          <div class='violation-row'>
                            {{#if (eq violation.severity 'error')}}
                              <CircleX
                                class='sev-icon sev-error'
                                width='14'
                                height='14'
                                aria-label='error'
                              />
                            {{else}}
                              <CircleAlert
                                class='sev-icon sev-warning'
                                width='14'
                                height='14'
                                aria-label='warning'
                              />
                            {{/if}}
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
                        {{/each}}
                      </div>
                    {{/if}}
                  </div>
                {{/each}}
              </div>
            </section>
          {{/if}}
        </:details>
      </ResultIsolatedCard>
      <style scoped>
        .detail-section {
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .detail-section > h2 {
          margin: 0;
          font: 600 var(--boxel-font-sm);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .detail-groups {
          display: grid;
          gap: var(--boxel-sp-sm);
        }
        .detail-group {
          border: 1px solid
            color-mix(
              in oklch,
              var(--border, var(--boxel-border-color)) 60%,
              transparent
            );
          border-radius: var(--boxel-border-radius);
          padding: var(--boxel-sp-sm);
        }
        .detail-group.has-errors {
          border-color: color-mix(
            in oklch,
            oklch(55% 0.22 25) 50%,
            transparent
          );
        }
        .detail-group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding-bottom: var(--boxel-sp-xs);
          border-bottom: 1px solid
            color-mix(
              in oklch,
              var(--border, var(--boxel-border-color)) 50%,
              transparent
            );
          margin-bottom: var(--boxel-sp-xs);
        }
        .detail-group-name {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          font-family: var(--boxel-monospace-font-family, monospace);
          word-break: break-all;
        }
        .group-status {
          flex-shrink: 0;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .group-status.clean {
          color: oklch(60% 0.17 150);
        }
        .group-status.errors {
          color: oklch(55% 0.22 25);
        }
        .violation-rows {
          display: grid;
          gap: var(--boxel-sp-4xs);
        }
        .violation-row {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
        }
        .sev-icon {
          flex-shrink: 0;
          align-self: center;
        }
        .sev-error {
          color: oklch(55% 0.22 25);
        }
        .sev-warning {
          color: oklch(68% 0.17 55);
        }
        .violation-location {
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-500));
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: var(--boxel-font-size-xs);
        }
        .violation-message {
          flex: 1;
        }
        .violation-rule {
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-500));
          font-size: var(--boxel-font-size-xs);
        }
      </style>
    </template>
  };
}

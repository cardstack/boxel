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
import { Project, Issue } from './darkfactory.gts';
import {
  ResultFittedCard,
  resultDisplayStatus,
  resultRunTitle,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';
import { ResultDetailsSection } from './result-details-section.gts';

import FileCode from '@cardstack/boxel-icons/file-code';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';

export const ParseResultStatusField = enumField(StringField, {
  options: [
    { value: 'running', label: 'Running' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
  ],
});

export class ParseError extends FieldDef {
  static displayName = 'Parse Error';

  @field file = contains(StringField);
  @field line = contains(NumberField);
  @field column = contains(NumberField);
  @field message = contains(StringField);

  static embedded = class Embedded extends Component<typeof ParseError> {
    <template>
      <div class='error-entry'>
        <span class='status-icon'>✗</span>
        <span class='location'>{{@model.file}}{{#if
            @model.line
          }}:{{@model.line}}{{/if}}</span>
        <span class='message'>{{@model.message}}</span>
      </div>
      <style scoped>
        .error-entry {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.85rem;
        }
        .status-icon {
          font-weight: bold;
          width: 1.25rem;
          text-align: center;
          flex-shrink: 0;
          color: var(--boxel-red, #dc2626);
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
      </style>
    </template>
  };
}

export class ParseFileResult extends FieldDef {
  static displayName = 'Parse File Result';

  @field file = contains(StringField);
  @field errors = containsMany(ParseError);

  @field errorCount = contains(NumberField, {
    computeVia: function (this: ParseFileResult) {
      return this.errors?.length ?? 0;
    },
  });

  get passed() {
    return (this.errorCount ?? 0) === 0;
  }

  get displayFile() {
    let f = this.file ?? '';
    if (f && !f.includes('.')) {
      return `${f}.json`;
    }
    return f;
  }

  static embedded = class Embedded extends Component<typeof ParseFileResult> {
    <template>
      <div class='file-result'>
        <div class='file-header'>
          <span class='file-name'>{{@model.displayFile}}</span>
          {{#if @model.passed}}
            <span class='file-status passed'>valid</span>
          {{else}}
            <span class='file-status failed'>
              {{@model.errorCount}}
              error(s)
            </span>
          {{/if}}
        </div>
        {{#if @model.errorCount}}
          <div class='file-errors'>
            <@fields.errors />
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
        .file-errors {
          padding-left: 0.5rem;
        }
      </style>
    </template>
  };
}

export class ParseResult extends CardDef {
  static displayName = 'Parse Result';

  @field sequenceNumber = contains(NumberField);
  @field runAt = contains(DateTimeField);
  @field completedAt = contains(DateTimeField);
  @field project = linksTo(() => Project);
  @field issue = linksTo(() => Issue);
  @field status = contains(ParseResultStatusField);
  @field durationMs = contains(NumberField);
  @field fileResults = containsMany(ParseFileResult);
  @field errorMessage = contains(StringField);

  @field totalErrors = contains(NumberField, {
    computeVia: function (this: ParseResult) {
      return (this.fileResults ?? []).reduce(
        (sum, fr) => sum + (fr.errorCount ?? 0),
        0,
      );
    },
  });

  @field filesChecked = contains(NumberField, {
    computeVia: function (this: ParseResult) {
      return this.fileResults?.length ?? 0;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ParseResult) {
      let seq = this.sequenceNumber ?? '?';
      let status = this.status ?? 'unknown';
      return `ParseResult #${seq} \u2014 ${status}`;
    },
  });

  get filesWithErrors() {
    return (this.fileResults ?? []).filter((fr) => !fr.passed).length;
  }

  get filesClean() {
    return (this.filesChecked ?? 0) - this.filesWithErrors;
  }

  static fitted = class Fitted extends Component<typeof ParseResult> {
    get displayStatus() {
      return resultDisplayStatus(
        this.args.model.filesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Parse Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [];
      if (m.filesChecked) {
        items.push({
          icon: CircleCheck,
          text: `${m.filesClean}/${m.filesChecked} valid`,
          tone: 'clean',
        });
      }
      if (m.totalErrors) {
        items.push({
          icon: CircleX,
          text: `${m.totalErrors} error(s)`,
          tone: 'error',
        });
      }
      return items;
    }

    <template>
      <ResultFittedCard
        @icon={{FileCode}}
        @label='Parse'
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

  static isolated = class Isolated extends Component<typeof ParseResult> {
    get displayStatus() {
      return resultDisplayStatus(
        this.args.model.filesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return resultRunTitle('Parse', this.args.model.sequenceNumber);
    }

    fileHasErrors = (file: ParseFileResult) => !file.passed;

    <template>
      <ResultIsolatedCard
        @title={{this.titleText}}
        @status={{this.displayStatus}}
        @emptyLabel='No Files'
        @durationMs={{@model.durationMs}}
        @runAt={{@model.runAt}}
        @completedAt={{@model.completedAt}}
        @hasProject={{@model.project}}
        @hasIssue={{@model.issue}}
        @hasError={{@model.errorMessage}}
      >
        <:summary>
          <span>{{@model.filesClean}}/{{@model.filesChecked}}
            files valid{{#if @model.totalErrors}},
              {{@model.totalErrors}}
              error(s){{/if}}</span>
        </:summary>
        <:project><@fields.project @format='embedded' /></:project>
        <:issue><@fields.issue @format='embedded' /></:issue>
        <:error>{{@model.errorMessage}}</:error>
        <:details>
          <ResultDetailsSection
            @sectionTitle='File Results'
            @items={{@model.fileResults}}
            @hasErrors={{this.fileHasErrors}}
          >
            <:header as |fileResult|>
              <span class='detail-group-name'>{{fileResult.displayFile}}</span>
              {{#if fileResult.passed}}
                <span class='group-status clean'>valid</span>
              {{else}}
                <span class='group-status errors'>
                  {{fileResult.errorCount}}
                  error(s)
                </span>
              {{/if}}
            </:header>
            <:body as |fileResult|>
              {{#if fileResult.errorCount}}
                <div class='error-rows'>
                  {{#each fileResult.errors as |error|}}
                    <div class='error-row'>
                      <CircleX
                        class='sev-icon sev-error'
                        width='14'
                        height='14'
                        aria-label='error'
                      />
                      {{#if error.line}}
                        <span
                          class='error-location'
                        >{{error.line}}:{{error.column}}</span>
                      {{/if}}
                      <span class='error-message-text'>{{error.message}}</span>
                    </div>
                  {{/each}}
                </div>
              {{/if}}
            </:body>
          </ResultDetailsSection>
        </:details>
      </ResultIsolatedCard>
      <style scoped>
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
          text-transform: uppercase;
        }
        .group-status.clean {
          color: oklch(60% 0.17 150);
        }
        .group-status.errors {
          color: oklch(55% 0.22 25);
        }
        .error-rows {
          display: grid;
          gap: var(--boxel-sp-4xs);
        }
        .error-row {
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
        .error-location {
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-500));
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: var(--boxel-font-size-xs);
        }
        .error-message-text {
          flex: 1;
        }
      </style>
    </template>
  };

  static edit = this.isolated;
}

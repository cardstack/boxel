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
  type ResultMetaItem,
} from './result-fitted-card.gts';

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
      if (
        (this.args.model.filesChecked ?? 0) === 0 &&
        this.args.model.status === 'passed'
      ) {
        return 'empty';
      }
      return this.args.model.status;
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Parse Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [
        {
          icon: CircleCheck,
          text: `${m.filesClean}/${m.filesChecked} valid`,
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
            <strong>ParseResult #{{@model.sequenceNumber}}</strong>
            <span
              class='status status-{{this.displayStatus}}'
            >{{this.displayStatus}}</span>
          </div>
          <div class='summary'>
            {{@model.filesClean}}/{{@model.filesChecked}}
            files valid
            {{#if @model.totalErrors}}
              ,
              {{@model.totalErrors}}
              error(s)
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
                  <span
                    class='file-group-name'
                  >{{fileResult.displayFile}}</span>
                  {{#if fileResult.passed}}
                    <span class='file-group-status has-passes'>valid</span>
                  {{else}}
                    <span class='file-group-status has-errors'>
                      {{fileResult.errorCount}}
                      error(s)
                    </span>
                  {{/if}}
                </div>
                {{#if fileResult.errorCount}}
                  <div class='file-group-errors'>
                    {{#each fileResult.errors as |error|}}
                      <div class='error-item'>
                        <div class='error-item-row'>
                          <span class='error-icon'>✗</span>
                          {{#if error.line}}
                            <span
                              class='error-location'
                            >{{error.line}}:{{error.column}}</span>
                          {{/if}}
                          <span
                            class='error-message-text'
                          >{{error.message}}</span>
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
        .file-group-errors {
          display: grid;
          gap: 0.25rem;
        }
        .error-item-row {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.85rem;
        }
        .error-icon {
          font-weight: bold;
          width: 1.25rem;
          text-align: center;
          flex-shrink: 0;
          color: var(--boxel-red, #dc2626);
        }
        .error-location {
          color: var(--muted-foreground);
          font-family: monospace;
          font-size: 0.8rem;
          flex-shrink: 0;
        }
        .error-message-text {
          flex: 1;
        }
      </style>
    </template>
  };
}

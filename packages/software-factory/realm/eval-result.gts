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

import Code from '@cardstack/boxel-icons/code';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';

export const EvalResultStatusField = enumField(StringField, {
  options: [
    { value: 'running', label: 'Running' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
  ],
});

export class EvalModuleResult extends FieldDef {
  static displayName = 'Eval Module Result';

  @field path = contains(StringField);
  @field error = contains(StringField);
  @field stackTrace = contains(StringField);

  get hasError() {
    return !!this.error;
  }

  static embedded = class Embedded extends Component<typeof EvalModuleResult> {
    <template>
      <div class='module-entry'>
        {{#if @model.hasError}}
          <span class='status-icon error-icon'>✗</span>
        {{else}}
          <span class='status-icon pass-icon'>✓</span>
        {{/if}}
        <span class='module-path'>{{@model.path}}</span>
        {{#if @model.error}}
          <span class='module-error'>{{@model.error}}</span>
        {{/if}}
      </div>
      <style scoped>
        .module-entry {
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
        }
        .error-icon {
          color: var(--boxel-red, #dc2626);
        }
        .pass-icon {
          color: var(--boxel-green, #16a34a);
        }
        .module-path {
          color: var(--muted-foreground);
          font-family: monospace;
          font-size: 0.8rem;
          flex-shrink: 0;
        }
        .module-error {
          flex: 1;
          color: var(--boxel-red, #dc2626);
        }
      </style>
    </template>
  };
}

export class EvalResult extends CardDef {
  static displayName = 'Eval Result';

  @field sequenceNumber = contains(NumberField);
  @field runAt = contains(DateTimeField);
  @field completedAt = contains(DateTimeField);
  @field project = linksTo(() => Project);
  @field issue = linksTo(() => Issue);
  @field status = contains(EvalResultStatusField);
  @field durationMs = contains(NumberField);
  @field moduleResults = containsMany(EvalModuleResult);
  @field errorMessage = contains(StringField);

  @field modulesChecked = contains(NumberField, {
    computeVia: function (this: EvalResult) {
      return this.moduleResults?.length ?? 0;
    },
  });

  @field modulesWithErrors = contains(NumberField, {
    computeVia: function (this: EvalResult) {
      return (this.moduleResults ?? []).filter((m) => !!m.error).length;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: EvalResult) {
      let seq = this.sequenceNumber ?? '?';
      let status = this.status ?? 'unknown';
      return `EvalResult #${seq} \u2014 ${status}`;
    },
  });

  get modulesPassed() {
    return (this.modulesChecked ?? 0) - (this.modulesWithErrors ?? 0);
  }

  static fitted = class Fitted extends Component<typeof EvalResult> {
    get displayStatus() {
      if (
        (this.args.model.modulesChecked ?? 0) === 0 &&
        this.args.model.status === 'passed'
      ) {
        return 'empty';
      }
      return this.args.model.status;
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Eval Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [
        {
          icon: CircleCheck,
          text: `${m.modulesPassed}/${m.modulesChecked} passed`,
          tone: 'clean',
        },
      ];
      if (m.modulesWithErrors) {
        items.push({
          icon: CircleX,
          text: `${m.modulesWithErrors} error(s)`,
          tone: 'error',
        });
      }
      return items;
    }

    <template>
      <ResultFittedCard
        @icon={{Code}}
        @label='Eval'
        @sequenceNumber={{@model.sequenceNumber}}
        @status={{this.displayStatus}}
        @emptyLabel='No Modules'
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

  static isolated = class Isolated extends Component<typeof EvalResult> {
    get displayStatus() {
      if (
        (this.args.model.modulesChecked ?? 0) === 0 &&
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
            <strong>EvalResult #{{@model.sequenceNumber}}</strong>
            <span
              class='status status-{{this.displayStatus}}'
            >{{this.displayStatus}}</span>
          </div>
          <div class='summary'>
            {{@model.modulesPassed}}/{{@model.modulesChecked}}
            modules passed
            {{#if @model.modulesWithErrors}}
              ,
              {{@model.modulesWithErrors}}
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

        {{#if @model.moduleResults.length}}
          <section>
            <h2>Module Results</h2>
            {{#each @model.moduleResults as |moduleResult|}}
              <div
                class='module-group
                  {{if moduleResult.hasError "module-has-errors"}}'
              >
                <div class='module-group-header'>
                  <span class='module-group-name'>{{moduleResult.path}}</span>
                  {{#if moduleResult.hasError}}
                    <span class='module-group-status has-errors'>error</span>
                  {{else}}
                    <span class='module-group-status has-passes'>passed</span>
                  {{/if}}
                </div>
                {{#if moduleResult.error}}
                  <div class='module-group-error'>
                    <pre class='error-code-block'>{{moduleResult.error}}</pre>
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
        .module-group {
          border: 1px solid var(--boxel-200, #e5e7eb);
          border-radius: 0.5rem;
          padding: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .module-has-errors {
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
          font-family: monospace;
        }
        .module-group-status {
          font-size: 0.8rem;
          color: var(--boxel-400, #9ca3af);
        }
        .module-group-status.has-passes {
          color: var(--boxel-green, #16a34a);
        }
        .module-group-status.has-errors {
          color: var(--boxel-red, #dc2626);
        }
        .module-group-error {
          padding: 0.5rem;
        }
        .error-code-block {
          color: var(--boxel-red, #dc2626);
          background: var(--boxel-100, #f3f4f6);
          border: 1px solid var(--boxel-200, #e5e7eb);
          border-radius: 0.375rem;
          padding: 0.75rem;
          font-family: monospace;
          font-size: 0.8rem;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 15rem;
          overflow-y: auto;
          margin: 0;
          line-height: 1.4;
        }
      </style>
    </template>
  };
}

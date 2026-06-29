import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import enumField from 'https://cardstack.com/base/enum';
import { RealmPaths } from '@cardstack/runtime-common';
import { Project, Issue } from './darkfactory.gts';
import {
  ResultFittedCard,
  type ResultMetaItem,
} from './result-fitted-card.gts';

import Box from '@cardstack/boxel-icons/box';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';

export const InstantiateResultStatusField = enumField(StringField, {
  options: [
    { value: 'running', label: 'Running' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
  ],
});

export class InstantiateCardEntry extends FieldDef {
  static displayName = 'Instantiate Card Entry';

  @field codeRef = contains(CodeRefField);
  @field instanceId = contains(StringField);
  @field error = contains(StringField);
  @field stackTrace = contains(StringField);

  get hasError() {
    return !!this.error;
  }

  get instancePath() {
    if (!this.instanceId) {
      return '(no instance)';
    }
    let cardRealmURLString = (this as any)[realmURL];
    if (cardRealmURLString) {
      try {
        return new RealmPaths(new URL(cardRealmURLString)).local(
          new URL(this.instanceId),
        );
      } catch {
        // instance URL is invalid or outside the realm — fall through
      }
    }
    return this.instanceId;
  }

  static embedded = class Embedded extends Component<
    typeof InstantiateCardEntry
  > {
    <template>
      <div class='card-entry'>
        {{#if @model.hasError}}
          <span class='status-icon error-icon'>✗</span>
        {{else}}
          <span class='status-icon pass-icon'>✓</span>
        {{/if}}
        <span class='instance-path'>{{@model.instancePath}}</span>
        {{#if @model.error}}
          <span class='card-error'>{{@model.error}}</span>
        {{/if}}
      </div>
      <style scoped>
        .card-entry {
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
        .instance-path {
          color: var(--muted-foreground);
          font-family: monospace;
          font-size: 0.8rem;
          flex-shrink: 0;
        }
        .card-error {
          flex: 1;
          color: var(--boxel-red, #dc2626);
        }
      </style>
    </template>
  };
}

export class InstantiateResult extends CardDef {
  static displayName = 'Instantiate Result';

  @field sequenceNumber = contains(NumberField);
  @field runAt = contains(DateTimeField);
  @field completedAt = contains(DateTimeField);
  @field project = linksTo(() => Project);
  @field issue = linksTo(() => Issue);
  @field status = contains(InstantiateResultStatusField);
  @field durationMs = contains(NumberField);
  @field cardResults = containsMany(InstantiateCardEntry);
  @field errorMessage = contains(StringField);

  @field cardsChecked = contains(NumberField, {
    computeVia: function (this: InstantiateResult) {
      return this.cardResults?.length ?? 0;
    },
  });

  @field cardsWithErrors = contains(NumberField, {
    computeVia: function (this: InstantiateResult) {
      return (this.cardResults ?? []).filter((c) => !!c.error).length;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: InstantiateResult) {
      let seq = this.sequenceNumber ?? '?';
      let status = this.status ?? 'unknown';
      return `InstantiateResult #${seq} \u2014 ${status}`;
    },
  });

  get cardsPassed() {
    return (this.cardsChecked ?? 0) - (this.cardsWithErrors ?? 0);
  }

  static fitted = class Fitted extends Component<typeof InstantiateResult> {
    get displayStatus() {
      if (
        (this.args.model.cardsChecked ?? 0) === 0 &&
        this.args.model.status === 'passed'
      ) {
        return 'empty';
      }
      return this.args.model.status;
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Instantiate Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [
        {
          icon: CircleCheck,
          text: `${m.cardsPassed}/${m.cardsChecked} passed`,
          tone: 'clean',
        },
      ];
      if (m.cardsWithErrors) {
        items.push({
          icon: CircleX,
          text: `${m.cardsWithErrors} error(s)`,
          tone: 'error',
        });
      }
      return items;
    }

    <template>
      <ResultFittedCard
        @icon={{Box}}
        @label='Instantiate'
        @sequenceNumber={{@model.sequenceNumber}}
        @status={{this.displayStatus}}
        @emptyLabel='No Cards'
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

  static isolated = class Isolated extends Component<typeof InstantiateResult> {
    get displayStatus() {
      if (
        (this.args.model.cardsChecked ?? 0) === 0 &&
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
            <strong>InstantiateResult #{{@model.sequenceNumber}}</strong>
            <span
              class='status status-{{this.displayStatus}}'
            >{{this.displayStatus}}</span>
          </div>
          <div class='summary'>
            {{@model.cardsPassed}}/{{@model.cardsChecked}}
            cards passed
            {{#if @model.cardsWithErrors}}
              ,
              {{@model.cardsWithErrors}}
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

        {{#if @model.cardResults.length}}
          <section>
            <h2>Card Results</h2>
            {{#each @model.cardResults as |cardResult|}}
              <div
                class='card-group {{if cardResult.hasError "card-has-errors"}}'
              >
                <div class='card-group-header'>
                  <span
                    class='card-group-name'
                  >{{cardResult.instancePath}}</span>
                  {{#if cardResult.hasError}}
                    <span class='card-group-status has-errors'>error</span>
                  {{else}}
                    <span class='card-group-status has-passes'>passed</span>
                  {{/if}}
                </div>
                {{#if cardResult.error}}
                  <div class='card-group-error'>
                    <pre class='error-code-block'>{{cardResult.error}}</pre>
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
        .card-group {
          border: 1px solid var(--boxel-200, #e5e7eb);
          border-radius: 0.5rem;
          padding: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .card-has-errors {
          border-color: var(--boxel-red, #dc2626);
        }
        .card-group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--boxel-200, #e5e7eb);
          margin-bottom: 0.5rem;
        }
        .card-group-name {
          font-weight: 600;
          font-size: 0.9rem;
          font-family: monospace;
        }
        .card-group-status {
          font-size: 0.8rem;
          color: var(--boxel-400, #9ca3af);
        }
        .card-group-status.has-passes {
          color: var(--boxel-green, #16a34a);
        }
        .card-group-status.has-errors {
          color: var(--boxel-red, #dc2626);
        }
        .card-group-error {
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

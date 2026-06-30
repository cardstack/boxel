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
  resultDisplayStatus,
  resultRunTitle,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';
import { ResultDetailsSection } from './result-details-section.gts';

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
      return resultDisplayStatus(
        this.args.model.cardsChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Instantiate Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [];
      if (m.cardsChecked) {
        items.push({
          icon: CircleCheck,
          text: `${m.cardsPassed}/${m.cardsChecked} passed`,
          tone: 'clean',
        });
      }
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
      return resultDisplayStatus(
        this.args.model.cardsChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return resultRunTitle('Instantiate', this.args.model.sequenceNumber);
    }

    cardHasError = (card: InstantiateCardEntry) => card.hasError;

    <template>
      <ResultIsolatedCard
        @title={{this.titleText}}
        @status={{this.displayStatus}}
        @emptyLabel='No Cards'
        @durationMs={{@model.durationMs}}
        @runAt={{@model.runAt}}
        @completedAt={{@model.completedAt}}
        @hasProject={{@model.project}}
        @hasIssue={{@model.issue}}
        @hasError={{@model.errorMessage}}
      >
        <:summary>
          <span>{{@model.cardsPassed}}/{{@model.cardsChecked}}
            cards passed{{#if @model.cardsWithErrors}},
              {{@model.cardsWithErrors}}
              error(s){{/if}}</span>
        </:summary>
        <:project><@fields.project @format='embedded' /></:project>
        <:issue><@fields.issue @format='embedded' /></:issue>
        <:error>{{@model.errorMessage}}</:error>
        <:details>
          <ResultDetailsSection
            @sectionTitle='Card Results'
            @items={{@model.cardResults}}
            @hasErrors={{this.cardHasError}}
          >
            <:header as |cardResult|>
              <span class='detail-group-name'>{{cardResult.instancePath}}</span>
              {{#if cardResult.hasError}}
                <span class='group-status errors'>error</span>
              {{else}}
                <span class='group-status clean'>passed</span>
              {{/if}}
            </:header>
            <:body as |cardResult|>
              {{#if cardResult.error}}
                <pre class='error-code-block'>{{cardResult.error}}</pre>
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
        .error-code-block {
          margin: 0;
          padding: var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius);
          background: color-mix(in oklch, oklch(55% 0.22 25) 8%, transparent);
          color: oklch(55% 0.22 25);
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: var(--boxel-font-size-xs);
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 15rem;
          overflow-y: auto;
          line-height: 1.4;
        }
      </style>
    </template>
  };

  static edit = this.isolated;
}

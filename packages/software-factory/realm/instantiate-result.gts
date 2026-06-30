import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import { RealmPaths } from '@cardstack/runtime-common';
import { ValidationResult } from './validation-result.gts';
import {
  ResultFittedCard,
  resultDisplayStatus,
  resultRunTitle,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';

import Box from '@cardstack/boxel-icons/box';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';

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
      <div class='detail-group {{if @model.hasError "has-errors"}}'>
        <div class='detail-group-header'>
          <span class='detail-group-name'>{{@model.instancePath}}</span>
          {{#if @model.hasError}}
            <span class='group-status errors'>error</span>
          {{else}}
            <span class='group-status clean'>passed</span>
          {{/if}}
        </div>
        {{#if @model.error}}
          <pre class='error-code-block'>{{@model.error}}</pre>
        {{/if}}
      </div>
      <style scoped>
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
}

export class InstantiateResult extends ValidationResult {
  static displayName = 'Instantiate Result';

  @field cardResults = containsMany(InstantiateCardEntry);

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

  get resultLabel() {
    return 'InstantiateResult';
  }

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
        @hasDetails={{@model.cardResults.length}}
        @detailsTitle='Card Results'
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
          <@fields.cardResults @format='embedded' />
        </:details>
      </ResultIsolatedCard>
    </template>
  };

  static edit = this.isolated;
}

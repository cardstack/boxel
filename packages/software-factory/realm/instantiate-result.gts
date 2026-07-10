import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  realmURL,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import CodeRefField from '@cardstack/base/code-ref';
import { RealmPaths } from '@cardstack/runtime-common';
import { ValidationResult } from './validation-result.gts';
import {
  ResultFittedCard,
  resultDisplayStatus,
  resultRunTitle,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';
import { ResultDetailGroup } from './result-detail-group.gts';

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
      <ResultDetailGroup
        @name={{@model.instancePath}}
        @monospaceName={{true}}
        @hasErrors={{@model.hasError}}
        @statusLabel={{if @model.hasError 'error' 'passed'}}
        @statusTone={{if @model.hasError 'errors' 'clean'}}
        @error={{@model.error}}
      />
    </template>
  };
}

export class InstantiateResult extends ValidationResult {
  static displayName = 'Instantiate Result';
  static icon = Box;

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
        @icon={{@model.constructor.icon}}
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

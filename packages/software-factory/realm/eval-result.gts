import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { ValidationResult } from './validation-result.gts';
import {
  ResultFittedCard,
  resultDisplayStatus,
  resultRunTitle,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';
import { ResultDetailGroup } from './result-detail-group.gts';

import Code from '@cardstack/boxel-icons/code';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';

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
      <ResultDetailGroup
        @name={{@model.path}}
        @monospaceName={{true}}
        @hasErrors={{@model.hasError}}
        @statusLabel={{if @model.hasError 'error' 'passed'}}
        @statusTone={{if @model.hasError 'errors' 'clean'}}
        @error={{@model.error}}
      />
    </template>
  };
}

export class EvalResult extends ValidationResult {
  static displayName = 'Eval Result';
  static icon = Code;

  @field moduleResults = containsMany(EvalModuleResult);

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

  get resultLabel() {
    return 'EvalResult';
  }

  get modulesPassed() {
    return (this.modulesChecked ?? 0) - (this.modulesWithErrors ?? 0);
  }

  static fitted = class Fitted extends Component<typeof EvalResult> {
    get displayStatus() {
      return resultDisplayStatus(
        this.args.model.modulesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Eval Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [];
      if (m.modulesChecked) {
        items.push({
          icon: CircleCheck,
          text: `${m.modulesPassed}/${m.modulesChecked} passed`,
          tone: 'clean',
        });
      }
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
        @icon={{@model.constructor.icon}}
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
      return resultDisplayStatus(
        this.args.model.modulesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return resultRunTitle('Eval', this.args.model.sequenceNumber);
    }

    <template>
      <ResultIsolatedCard
        @title={{this.titleText}}
        @status={{this.displayStatus}}
        @emptyLabel='No Modules'
        @durationMs={{@model.durationMs}}
        @runAt={{@model.runAt}}
        @completedAt={{@model.completedAt}}
        @hasProject={{@model.project}}
        @hasIssue={{@model.issue}}
        @hasError={{@model.errorMessage}}
        @hasDetails={{@model.moduleResults.length}}
        @detailsTitle='Module Results'
      >
        <:summary>
          <span>{{@model.modulesPassed}}/{{@model.modulesChecked}}
            modules passed{{#if @model.modulesWithErrors}},
              {{@model.modulesWithErrors}}
              error(s){{/if}}</span>
        </:summary>
        <:project><@fields.project @format='embedded' /></:project>
        <:issue><@fields.issue @format='embedded' /></:issue>
        <:error>{{@model.errorMessage}}</:error>
        <:details>
          <@fields.moduleResults @format='embedded' />
        </:details>
      </ResultIsolatedCard>
    </template>
  };

  static edit = this.isolated;
}

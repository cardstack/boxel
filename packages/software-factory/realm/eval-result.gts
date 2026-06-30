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
      return resultDisplayStatus(
        this.args.model.modulesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return resultRunTitle('Eval', this.args.model.sequenceNumber);
    }

    moduleHasError = (module: EvalModuleResult) => module.hasError;

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
          <ResultDetailsSection
            @sectionTitle='Module Results'
            @items={{@model.moduleResults}}
            @hasErrors={{this.moduleHasError}}
          >
            <:header as |moduleResult|>
              <span class='detail-group-name'>{{moduleResult.path}}</span>
              {{#if moduleResult.hasError}}
                <span class='group-status errors'>error</span>
              {{else}}
                <span class='group-status clean'>passed</span>
              {{/if}}
            </:header>
            <:body as |moduleResult|>
              {{#if moduleResult.error}}
                <pre class='error-code-block'>{{moduleResult.error}}</pre>
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

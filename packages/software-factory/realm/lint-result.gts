import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import enumField from 'https://cardstack.com/base/enum';
import { eq } from '@cardstack/boxel-ui/helpers';
import { ValidationResult } from './validation-result.gts';
import {
  ResultFittedCard,
  resultDisplayStatus,
  resultRunTitle,
  type ResultMetaItem,
} from './result-fitted-card.gts';
import { ResultIsolatedCard } from './result-isolated-card.gts';

import ListChecks from '@cardstack/boxel-icons/list-checks';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';

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

  static embedded = class Embedded extends Component<typeof LintViolation> {
    <template>
      <div class='violation-row'>
        {{#if (eq @model.severity 'error')}}
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
        >{{@model.line}}:{{@model.column}}</span>
        <span class='violation-message'>{{@model.message}}</span>
        {{#if @model.rule}}
          <span class='violation-rule'>[{{@model.rule}}]</span>
        {{/if}}
      </div>
      <style scoped>
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
      <div class='detail-group {{unless @model.passed "has-errors"}}'>
        <div class='detail-group-header'>
          <span class='detail-group-name'>{{@model.file}}</span>
          {{#if @model.passed}}
            <span class='group-status clean'>clean</span>
          {{else}}
            <span class='group-status errors'>{{@model.errorCount}}
              error(s){{#if @model.warningCount}},
                {{@model.warningCount}}
                warning(s){{/if}}</span>
          {{/if}}
        </div>
        {{#if @model.totalCount}}
          <div class='violation-rows'>
            <@fields.violations @format='embedded' />
          </div>
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
        .violation-rows :deep(.containsMany-field.embedded-format) {
          gap: var(--boxel-sp-4xs);
        }
      </style>
    </template>
  };
}

export class LintResult extends ValidationResult {
  static displayName = 'Lint Result';

  @field fileResults = containsMany(LintFileResult);

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

  get resultLabel() {
    return 'LintResult';
  }

  get filesWithErrors() {
    return (this.fileResults ?? []).filter((fr) => !fr.passed).length;
  }

  get filesClean() {
    return (this.filesChecked ?? 0) - this.filesWithErrors;
  }

  static fitted = class Fitted extends Component<typeof LintResult> {
    get displayStatus() {
      return resultDisplayStatus(
        this.args.model.filesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Lint Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [];
      if (m.filesChecked) {
        items.push({
          icon: CircleCheck,
          text: `${m.filesClean}/${m.filesChecked} clean`,
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
      return resultDisplayStatus(
        this.args.model.filesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return resultRunTitle('Lint', this.args.model.sequenceNumber);
    }

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
        @hasDetails={{@model.fileResults.length}}
        @detailsTitle='File Results'
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
          <@fields.fileResults @format='embedded' />
        </:details>
      </ResultIsolatedCard>
    </template>
  };

  static edit = this.isolated;
}

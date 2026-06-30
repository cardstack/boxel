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
import { ResultDetailGroup } from './result-detail-group.gts';
import { ResultDetailRow } from './result-detail-row.gts';

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
      <ResultDetailRow
        @tone={{if (eq @model.severity 'error') 'error' 'warning'}}
        @line={{@model.line}}
        @column={{@model.column}}
        @message={{@model.message}}
        @trailing={{@model.rule}}
      />
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
    get statusLabel() {
      let m = this.args.model;
      if (m.passed) return 'clean';
      let label = `${m.errorCount} error(s)`;
      if (m.warningCount) label += `, ${m.warningCount} warning(s)`;
      return label;
    }

    <template>
      <ResultDetailGroup
        @name={{@model.file}}
        @monospaceName={{true}}
        @hasErrors={{unless @model.passed true}}
        @statusLabel={{this.statusLabel}}
        @statusTone={{if @model.passed 'clean' 'errors'}}
      >
        {{#if @model.totalCount}}
          <@fields.violations @format='embedded' />
        {{/if}}
      </ResultDetailGroup>
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

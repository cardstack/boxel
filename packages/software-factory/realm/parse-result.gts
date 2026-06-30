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
import { ResultDetailRow } from './result-detail-row.gts';

import FileCode from '@cardstack/boxel-icons/file-code';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';

export class ParseError extends FieldDef {
  static displayName = 'Parse Error';

  @field file = contains(StringField);
  @field line = contains(NumberField);
  @field column = contains(NumberField);
  @field message = contains(StringField);

  static embedded = class Embedded extends Component<typeof ParseError> {
    <template>
      <ResultDetailRow
        @tone='error'
        @line={{@model.line}}
        @column={{@model.column}}
        @message={{@model.message}}
      />
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
    get statusLabel() {
      let m = this.args.model;
      return m.passed ? 'valid' : `${m.errorCount} error(s)`;
    }

    <template>
      <ResultDetailGroup
        @name={{@model.displayFile}}
        @monospaceName={{true}}
        @hasErrors={{unless @model.passed true}}
        @statusLabel={{this.statusLabel}}
        @statusTone={{if @model.passed 'clean' 'errors'}}
      >
        {{#if @model.errorCount}}
          <@fields.errors @format='embedded' />
        {{/if}}
      </ResultDetailGroup>
    </template>
  };
}

export class ParseResult extends ValidationResult {
  static displayName = 'Parse Result';

  @field fileResults = containsMany(ParseFileResult);

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

  get resultLabel() {
    return 'ParseResult';
  }

  get filesWithErrors() {
    return (this.fileResults ?? []).filter((fr) => !fr.passed).length;
  }

  get filesClean() {
    return (this.filesChecked ?? 0) - this.filesWithErrors;
  }

  static fitted = class Fitted extends Component<typeof ParseResult> {
    get displayStatus() {
      return resultDisplayStatus(
        this.args.model.filesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Parse Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [];
      if (m.filesChecked) {
        items.push({
          icon: CircleCheck,
          text: `${m.filesClean}/${m.filesChecked} valid`,
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
      return resultDisplayStatus(
        this.args.model.filesChecked,
        this.args.model.status,
      );
    }

    get titleText() {
      return resultRunTitle('Parse', this.args.model.sequenceNumber);
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
            files valid{{#if @model.totalErrors}},
              {{@model.totalErrors}}
              error(s){{/if}}</span>
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

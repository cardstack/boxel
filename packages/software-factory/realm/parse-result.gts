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
      <div class='error-row'>
        <CircleX
          class='sev-icon sev-error'
          width='14'
          height='14'
          aria-label='error'
        />
        {{#if @model.line}}
          <span class='error-location'>{{@model.line}}:{{@model.column}}</span>
        {{/if}}
        <span class='error-message-text'>{{@model.message}}</span>
      </div>
      <style scoped>
        .error-row {
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
        .error-location {
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-500));
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: var(--boxel-font-size-xs);
        }
        .error-message-text {
          flex: 1;
        }
      </style>
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
    <template>
      <div class='detail-group {{unless @model.passed "has-errors"}}'>
        <div class='detail-group-header'>
          <span class='detail-group-name'>{{@model.displayFile}}</span>
          {{#if @model.passed}}
            <span class='group-status clean'>valid</span>
          {{else}}
            <span class='group-status errors'>{{@model.errorCount}}
              error(s)</span>
          {{/if}}
        </div>
        {{#if @model.errorCount}}
          <div class='error-rows'>
            <@fields.errors @format='embedded' />
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
        .error-rows :deep(.containsMany-field.embedded-format) {
          gap: var(--boxel-sp-4xs);
        }
      </style>
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

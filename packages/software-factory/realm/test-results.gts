import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import CodeRefField from '@cardstack/base/code-ref';
import enumField from '@cardstack/base/enum';
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

import FlaskConical from '@cardstack/boxel-icons/flask-conical';
import CircleCheck from '@cardstack/boxel-icons/circle-check';
import CircleX from '@cardstack/boxel-icons/circle-x';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';
import CircleMinus from '@cardstack/boxel-icons/circle-minus';
import CircleDashed from '@cardstack/boxel-icons/circle-dashed';

export const TestResultStatusField = enumField(StringField, {
  options: [
    { value: 'pending', label: 'Pending' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
    { value: 'skipped', label: 'Skipped' },
  ],
});

export class TestResultEntry extends FieldDef {
  static displayName = 'Test Result Entry';

  @field testName = contains(StringField);
  @field status = contains(TestResultStatusField);
  @field message = contains(StringField);
  @field stackTrace = contains(StringField);
  @field durationMs = contains(NumberField);

  static embedded = class Embedded extends Component<typeof TestResultEntry> {
    <template>
      <div class='test-row'>
        <div class='test-row-main'>
          {{#if (eq @model.status 'passed')}}
            <CircleCheck
              class='test-icon icon-passed'
              width='14'
              height='14'
              aria-label='passed'
            />
          {{else if (eq @model.status 'failed')}}
            <CircleX
              class='test-icon icon-failed'
              width='14'
              height='14'
              aria-label='failed'
            />
          {{else if (eq @model.status 'error')}}
            <CircleAlert
              class='test-icon icon-error'
              width='14'
              height='14'
              aria-label='error'
            />
          {{else if (eq @model.status 'skipped')}}
            <CircleMinus
              class='test-icon icon-skipped'
              width='14'
              height='14'
              aria-label='skipped'
            />
          {{else}}
            <CircleDashed
              class='test-icon icon-pending'
              width='14'
              height='14'
              aria-label='pending'
            />
          {{/if}}
          <span class='test-name'>{{@model.testName}}</span>
          {{#if @model.durationMs}}
            <span class='test-duration'>{{@model.durationMs}}ms</span>
          {{/if}}
        </div>
        {{#if @model.message}}
          <pre class='failure-message'>{{@model.message}}</pre>
        {{/if}}
        {{#if @model.stackTrace}}
          <pre class='failure-stack'>{{@model.stackTrace}}</pre>
        {{/if}}
      </div>
      <style scoped>
        .test-row-main {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
        }
        .test-icon {
          flex-shrink: 0;
        }
        .icon-passed {
          color: oklch(60% 0.17 150);
        }
        .icon-failed {
          color: oklch(55% 0.22 25);
        }
        .icon-error {
          color: oklch(68% 0.17 55);
        }
        .icon-skipped,
        .icon-pending {
          color: var(--muted-foreground, var(--boxel-500));
        }
        .test-name {
          flex: 1;
        }
        .test-duration {
          flex-shrink: 0;
          color: var(--muted-foreground, var(--boxel-500));
          font-size: var(--boxel-font-size-xs);
        }
        .failure-message,
        .failure-stack {
          margin: var(--boxel-sp-4xs) 0 var(--boxel-sp-4xs) var(--boxel-sp-lg);
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: var(--boxel-font-size-xs);
          white-space: pre-wrap;
          overflow-x: auto;
          max-width: 100%;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .failure-stack {
          opacity: 0.7;
        }
      </style>
    </template>
  };
}

export class TestModuleResult extends FieldDef {
  static displayName = 'Test Module Result';

  @field moduleRef = contains(CodeRefField);
  @field results = containsMany(TestResultEntry);

  @field passedCount = contains(NumberField, {
    computeVia: function (this: TestModuleResult) {
      return (this.results ?? []).filter((r) => r.status === 'passed').length;
    },
  });

  @field failedCount = contains(NumberField, {
    computeVia: function (this: TestModuleResult) {
      return (this.results ?? []).filter(
        (r) => r.status === 'failed' || r.status === 'error',
      ).length;
    },
  });

  @field skippedCount = contains(NumberField, {
    computeVia: function (this: TestModuleResult) {
      return (this.results ?? []).filter((r) => r.status === 'skipped').length;
    },
  });

  get moduleName() {
    return this.moduleRef?.module ?? 'default';
  }

  get totalCount() {
    return this.results?.length ?? 0;
  }

  get isComplete() {
    return !(this.results ?? []).some((r) => r.status === 'pending');
  }

  static embedded = class Embedded extends Component<typeof TestModuleResult> {
    get statusTone() {
      let m = this.args.model;
      if (!m.isComplete) return 'running';
      if (m.failedCount) return 'errors';
      return m.passedCount ? 'clean' : 'muted';
    }

    get statusLabel() {
      let m = this.args.model;
      if (!m.isComplete) return 'running…';
      let label = m.failedCount
        ? `${m.passedCount} passed, ${m.failedCount} failed`
        : `${m.passedCount}/${m.totalCount} passed`;
      if (m.skippedCount) label += ` (${m.skippedCount} skipped)`;
      return label;
    }

    <template>
      <ResultDetailGroup
        @name={{@model.moduleName}}
        @hasErrors={{@model.failedCount}}
        @statusLabel={{this.statusLabel}}
        @statusTone={{this.statusTone}}
      >
        <@fields.results @format='embedded' />
      </ResultDetailGroup>
    </template>
  };
}

export class TestRun extends ValidationResult {
  static displayName = 'Test Run';
  static icon = FlaskConical;

  @field moduleResults = containsMany(TestModuleResult);

  @field passedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.moduleResults ?? []).reduce(
        (sum, sr) => sum + (sr.passedCount ?? 0),
        0,
      );
    },
  });

  @field failedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.moduleResults ?? []).reduce(
        (sum, sr) => sum + (sr.failedCount ?? 0),
        0,
      );
    },
  });

  @field skippedCount = contains(NumberField, {
    computeVia: function (this: TestRun) {
      return (this.moduleResults ?? []).reduce(
        (sum, sr) => sum + (sr.skippedCount ?? 0),
        0,
      );
    },
  });

  get resultLabel() {
    return 'TestRun';
  }

  static fitted = class Fitted extends Component<typeof TestRun> {
    get total() {
      return (
        (this.args.model.passedCount ?? 0) +
        (this.args.model.failedCount ?? 0) +
        (this.args.model.skippedCount ?? 0)
      );
    }

    get displayStatus() {
      return resultDisplayStatus(this.total, this.args.model.status);
    }

    get titleText() {
      return this.args.model.issue?.summary ?? 'Test Run';
    }

    get metaItems(): ResultMetaItem[] {
      let m = this.args.model;
      let items: ResultMetaItem[] = [];
      if (this.total) {
        items.push({
          icon: CircleCheck,
          text: `${m.passedCount}/${this.total} passed`,
          tone: 'clean',
        });
      }
      if (m.failedCount) {
        items.push({
          icon: CircleX,
          text: `${m.failedCount} failed`,
          tone: 'error',
        });
      }
      if (m.skippedCount) {
        items.push({
          icon: CircleMinus,
          text: `${m.skippedCount} skipped`,
          tone: 'muted',
        });
      }
      return items;
    }

    <template>
      <ResultFittedCard
        @icon={{@model.constructor.icon}}
        @label='Tests'
        @sequenceNumber={{@model.sequenceNumber}}
        @status={{this.displayStatus}}
        @emptyLabel='No Tests'
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

  static isolated = class Isolated extends Component<typeof TestRun> {
    get total() {
      return (
        (this.args.model.passedCount ?? 0) +
        (this.args.model.failedCount ?? 0) +
        (this.args.model.skippedCount ?? 0)
      );
    }

    get displayStatus() {
      return resultDisplayStatus(this.total, this.args.model.status);
    }

    get titleText() {
      return resultRunTitle('Test', this.args.model.sequenceNumber);
    }

    <template>
      <ResultIsolatedCard
        @title={{this.titleText}}
        @status={{this.displayStatus}}
        @emptyLabel='No Tests'
        @durationMs={{@model.durationMs}}
        @runAt={{@model.runAt}}
        @completedAt={{@model.completedAt}}
        @hasProject={{@model.project}}
        @hasIssue={{@model.issue}}
        @hasError={{@model.errorMessage}}
        @hasDetails={{@model.moduleResults.length}}
        @detailsTitle='Test Results'
      >
        <:summary>
          <span>{{@model.passedCount}}/{{this.total}}
            passed{{#if @model.skippedCount}}
              <span class='skipped'>({{@model.skippedCount}} skipped)</span>
            {{/if}}</span>
        </:summary>
        <:project><@fields.project @format='embedded' /></:project>
        <:issue><@fields.issue @format='embedded' /></:issue>
        <:error>{{@model.errorMessage}}</:error>
        <:details>
          <@fields.moduleResults @format='embedded' />
        </:details>
      </ResultIsolatedCard>
      <style scoped>
        .skipped {
          font-style: italic;
        }
      </style>
    </template>
  };

  static edit = this.isolated;
}

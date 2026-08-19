import { CardDef, field, contains, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateTimeField from '@cardstack/base/datetime';
import enumField from '@cardstack/base/enum';
import { Project, Issue } from './darkfactory.gts';

// Lifecycle status shared by every validation run.
export const ValidationStatusField = enumField(StringField, {
  options: [
    { value: 'running', label: 'Running' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
  ],
});

// Common base for every validator's result card (lint, parse, eval,
// instantiate, test). Holds the metadata every run records; subclasses add
// their own counts, detail array, and format components. Extending this lets a
// realm query all runs polymorphically via `adoptsFrom ValidationResult`.
export class ValidationResult extends CardDef {
  static displayName = 'Validation Result';

  @field sequenceNumber = contains(NumberField);
  @field runAt = contains(DateTimeField);
  @field completedAt = contains(DateTimeField);
  @field project = linksTo(() => Project);
  @field issue = linksTo(() => Issue);
  @field status = contains(ValidationStatusField);
  @field durationMs = contains(NumberField);
  @field errorMessage = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ValidationResult) {
      let seq = this.sequenceNumber ?? '?';
      let status = this.status ?? 'unknown';
      return `${this.resultLabel} #${seq} — ${status}`;
    },
  });

  // Title prefix for `cardTitle`; subclasses override with their card name.
  get resultLabel(): string {
    return 'Result';
  }
}

import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import DurationField from '../fields/time/duration';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class DurationFieldSpec extends Spec {
  static displayName = 'Duration Field Spec';

  // Standard DurationField - default configuration
  @field standard = contains(DurationField);

  // Full duration - all time units (years, months, days, hours, minutes, seconds)
  @field full = contains(DurationField, {
    configuration: {
      includeYears: true,
      includeMonths: true,
      includeDays: true,
      includeHours: true,
      includeMinutes: true,
      includeSeconds: true,
    },
  });

  // Day-time duration - no years/months (avoids month-length ambiguity)
  @field dayTime = contains(DurationField, {
    configuration: {
      includeDays: true,
      includeHours: true,
      includeMinutes: true,
      includeSeconds: true,
    },
  });

  // Year-month duration - calendar-based periods (contracts, subscriptions)
  @field yearMonth = contains(DurationField, {
    configuration: {
      includeYears: true,
      includeMonths: true,
    },
  });

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

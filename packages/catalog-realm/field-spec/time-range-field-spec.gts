import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import TimeRangeField from '../fields/time/time-range';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class TimeRangeFieldSpec extends Spec {
  static displayName = 'Time Range Field Spec';

  // Standard TimeRangeField - default configuration
  @field standard = contains(TimeRangeField);

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

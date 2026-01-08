import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import DateRangeField from '../fields/date/date-range';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class DateRangeFieldSpec extends Spec {
  static displayName = 'Date Range Field Spec';

  // Standard DateRangeField - default configuration
  @field standard = contains(DateRangeField);

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

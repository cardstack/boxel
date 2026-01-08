import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import MonthYearField from '../fields/date/month-year';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class MonthYearFieldSpec extends Spec {
  static displayName = 'Month Year Field Spec';

  // Standard MonthYearField - default configuration
  @field standard = contains(MonthYearField);

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

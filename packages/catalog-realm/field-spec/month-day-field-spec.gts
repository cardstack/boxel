import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import MonthDayField from '../fields/date/month-day';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class MonthDayFieldSpec extends Spec {
  static displayName = 'Month Day Field Spec';

  // Standard MonthDayField - default configuration
  @field standard = contains(MonthDayField);

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

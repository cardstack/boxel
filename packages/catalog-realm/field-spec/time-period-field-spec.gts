import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import TimePeriodField from '../fields/time-period';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class TimePeriodFieldSpec extends Spec {
  static displayName = 'Time Period Field Spec';

  // Standard TimePeriodField - default configuration
  @field standard = contains(TimePeriodField);

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

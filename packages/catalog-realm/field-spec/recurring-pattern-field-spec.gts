import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import RecurringPatternField from '../fields/recurring-pattern';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class RecurringPatternFieldSpec extends Spec {
  static displayName = 'Recurring Pattern Field Spec';

  // Standard RecurringPatternField - default configuration
  @field standard = contains(RecurringPatternField);

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

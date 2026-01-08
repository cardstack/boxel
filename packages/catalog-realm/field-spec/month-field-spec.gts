import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import MonthField from '../fields/date/month';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class MonthFieldSpec extends Spec {
  static displayName = 'Month Field Spec';

  // Standard MonthField - default configuration
  @field standard = contains(MonthField);

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

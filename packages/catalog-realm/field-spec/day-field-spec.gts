import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import DayField from '../fields/date/day';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class DayFieldSpec extends Spec {
  static displayName = 'Day Field Spec';

  // Standard DayField - default configuration
  @field standard = contains(DayField);

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

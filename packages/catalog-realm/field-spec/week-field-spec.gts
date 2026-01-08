import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import WeekField from '../fields/date/week';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class WeekFieldSpec extends Spec {
  static displayName = 'Week Field Spec';

  // Standard WeekField - default configuration
  @field standard = contains(WeekField);

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

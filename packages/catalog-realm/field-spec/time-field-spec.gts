import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import TimeField from '../fields/time';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class TimeFieldSpec extends Spec {
  static displayName = 'Time Field Spec';

  // Standard TimeField - default configuration
  @field standard = contains(TimeField);

  // 24-hour format - 24-hour time display
  @field hour24 = contains(TimeField, {
    configuration: {
      hourCycle: 'h23',
    },
  });

  // Long style - includes timezone information
  @field longStyle = contains(TimeField, {
    configuration: {
      timeStyle: 'long',
    },
  });

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

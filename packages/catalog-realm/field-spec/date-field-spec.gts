import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import DateField from '../fields/date';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class DateFieldSpec extends Spec {
  static displayName = 'Date Field Spec';

  // Standard DateField - default configuration
  @field standard = contains(DateField);

  // Compact preset - tiny preset for space-saving
  @field compact = contains(DateField, {
    configuration: {
      preset: 'tiny',
    },
  });

  // Custom format - custom date formatting
  @field customFormat = contains(DateField, {
    configuration: {
      format: 'MMM D, YYYY',
    },
  });

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

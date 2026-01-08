import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import DatetimeField from '../fields/date-time';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class DatetimeFieldSpec extends Spec {
  static displayName = 'Datetime Field Spec';

  // Standard DatetimeField - default configuration
  @field standard = contains(DatetimeField);

  // Short format - compact datetime display
  @field short = contains(DatetimeField, {
    configuration: {
      preset: 'short',
    },
  });

  // Custom format - custom datetime formatting
  @field customFormat = contains(DatetimeField, {
    configuration: {
      format: 'ddd, MMM D [at] h:mm A',
    },
  });

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

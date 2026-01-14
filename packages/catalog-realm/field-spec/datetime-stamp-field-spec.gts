import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import DatetimeStampField from '../fields/datetime-stamp';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class DatetimeStampFieldSpec extends Spec {
  static displayName = 'Datetime Stamp Field Spec';

  // Standard DatetimeStampField - default configuration
  @field standard = contains(DatetimeStampField);

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

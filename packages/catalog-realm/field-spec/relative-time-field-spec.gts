import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import RelativeTimeField from '../fields/time/relative-time';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class RelativeTimeFieldSpec extends Spec {
  static displayName = 'Relative Time Field Spec';

  // Standard RelativeTimeField - default configuration
  @field standard = contains(RelativeTimeField);

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

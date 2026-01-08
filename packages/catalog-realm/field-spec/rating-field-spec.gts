import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import RatingField from '../fields/rating';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class RatingFieldSpec extends Spec {
  static displayName = 'Rating Field Spec';

  // Standard RatingField - default configuration
  @field standard = contains(RatingField);

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

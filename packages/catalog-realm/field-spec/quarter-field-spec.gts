import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import QuarterField from '../fields/date/quarter';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class QuarterFieldSpec extends Spec {
  static displayName = 'Quarter Field Spec';

  // Standard QuarterField - default configuration
  @field standard = contains(QuarterField);

  static isolated = FieldSpecIsolatedTemplate;
  static edit = FieldSpecEditTemplate;
}

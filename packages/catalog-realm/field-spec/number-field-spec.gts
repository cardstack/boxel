import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import NumberField from '../fields/number';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class NumberFieldSpec extends Spec {
  static displayName = 'Number Field Spec';

  // Standard NumberField - default configuration
  @field standard = contains(NumberField);

  // Progress bar presentation
  @field progressBar = contains(NumberField, {
    configuration: {
      presentation: 'progress-bar',
    },
  });

  // Progress circle presentation
  @field progressCircle = contains(NumberField, {
    configuration: {
      presentation: 'progress-circle',
    },
  });

  // Stat presentation
  @field stat = contains(NumberField, {
    configuration: {
      presentation: 'stat',
    },
  });

  // Score presentation
  @field score = contains(NumberField, {
    configuration: {
      presentation: 'score',
    },
  });

  // Badge notification presentation
  @field badgeNotification = contains(NumberField, {
    configuration: {
      presentation: 'badge-notification',
    },
  });

  // Badge metric presentation
  @field badgeMetric = contains(NumberField, {
    configuration: {
      presentation: 'badge-metric',
    },
  });

  // Badge counter presentation
  @field badgeCounter = contains(NumberField, {
    configuration: {
      presentation: 'badge-counter',
    },
  });

  // Gauge presentation
  @field gauge = contains(NumberField, {
    configuration: {
      presentation: 'gauge',
    },
  });

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}
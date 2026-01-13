import { Spec } from 'https://cardstack.com/base/spec';
import { field, contains } from 'https://cardstack.com/base/card-api';
import ColorField from '../fields/color';
import FieldSpecEditTemplate from './components/field-spec-edit-template';
import FieldSpecIsolatedTemplate from './components/field-spec-isolated-template';

export class ColorFieldSpec extends Spec {
  static displayName = 'Color Field Spec';

  // Standard ColorField - default configuration
  @field standard = contains(ColorField);

  // Wheel picker variant
  @field wheel = contains(ColorField, {
    configuration: {
      variant: 'wheel',
    },
  });

  // Slider variant with RGB format
  @field sliderRgb = contains(ColorField, {
    configuration: {
      variant: 'slider',
      options: {
        defaultFormat: 'rgb',
      },
    },
  });

  // Slider variant with HSL format
  @field sliderHsl = contains(ColorField, {
    configuration: {
      variant: 'slider',
      options: {
        defaultFormat: 'hsl',
      },
    },
  });

  // Swatches picker variant
  @field swatchesPicker = contains(ColorField, {
    configuration: {
      variant: 'swatches-picker',
    },
  });

  // Advanced color picker variant
  @field advanced = contains(ColorField, {
    configuration: {
      variant: 'advanced',
    },
  });

  // With WCAG contrast checker
  @field withContrastChecker = contains(ColorField, {
    configuration: {
      options: {
        showContrastChecker: true,
      },
    },
  });

  static isolated =
    FieldSpecIsolatedTemplate as unknown as typeof Spec.isolated;
  static edit = FieldSpecEditTemplate as unknown as typeof Spec.edit;
}

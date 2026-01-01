import { Spec } from 'https://cardstack.com/base/spec';
import BoxModel from '@cardstack/boxel-icons/box-model';
import type { FieldConfiguration } from 'https://cardstack.com/base/card-api';

/**
 * ColorFieldSpec demonstrates different configuration options for ColorField.
 *
 * The fieldConfigurations object defines various configuration examples that will
 * be displayed in the "Configurations" section of the spec's isolated and edit views.
 * Each key represents a configuration name, and the value is the FieldConfiguration
 * that will be applied to the ColorField instance.
 *
 * These configurations will be automatically merged with ColorField's static
 * configuration (if any) and passed to the field component as @configuration.
 */
export class ColorFieldSpec extends Spec {
  static displayName = 'Color Field Spec';
  static icon = BoxModel;
  static specType = 'field';
  static fieldConfigurations: Record<string, FieldConfiguration | undefined> = {
    // Standard configuration (no variant specified, uses default)
    colorStandard: undefined,

    // Wheel variant with RGB format
    colorWheel: {
      variant: 'wheel',
      options: {
        defaultFormat: 'rgb',
      },
    },

    // Slider variant with RGB format
    colorSliderRgb: {
      variant: 'slider',
      options: {
        defaultFormat: 'rgb',
      },
    },

    // Slider variant with HSL format
    colorSliderHsl: {
      variant: 'slider',
      options: {
        defaultFormat: 'hsl',
      },
    },

    // Swatches picker variant
    colorSwatchesPicker: {
      variant: 'swatches-picker',
    },

    // Advanced variant
    colorAdvanced: {
      variant: 'advanced',
    },

    // Standard variant with recent colors feature
    colorShowRecent: {
      options: {
        showRecent: true,
      },
    },

    // Standard variant with contrast checker feature
    colorShowContrast: {
      options: {
        showContrastChecker: true,
      },
    },
  };
}

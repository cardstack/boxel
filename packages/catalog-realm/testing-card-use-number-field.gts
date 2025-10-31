import { CardDef, contains, field } from 'https://cardstack.com/base/card-api';
import {
  BasicNumberField,
  CurrencyNumberField,
  PercentageNumberField,
  SliderNumberField,
  StepperNumberField,
  RatingNumberField,
  QuantityNumberField,
  PinNumberField,
  PhoneNumberField,
  NumberRange,
  StatNumberField,
  ProgressBarNumberField,
  ProgressCircleNumberField,
  GaugeNumberField,
  BadgeNumberField,
  AnimatedCounterNumberField,
  ScoreNumberField,
} from './fields/number';

export class TestingCardUseNumberField extends CardDef {
  static displayName = 'Number Field Showcase Card';

  @field basic = contains(BasicNumberField, {
    configuration: {
      presentation: {
        allowNegative: true,
        min: 0,
        placeholder: 'Enter age',
      },
    },
  });

  @field currency = contains(CurrencyNumberField, {
    configuration: {
      presentation: {
        min: 0,
        step: 1,
      },
    },
  });

  @field percentage = contains(PercentageNumberField, {
    configuration: {
      presentation: {
        min: 0,
        max: 100,
      },
    },
  });

  @field slider = contains(SliderNumberField, {
    configuration: {
      presentation: {
        min: 0,
        max: 100,
        step: 5,
        showValue: true,
      },
    },
  });

  @field stepper = contains(StepperNumberField, {
    configuration: {
      presentation: {
        min: 0,
        step: 1,
      },
    },
  });

  @field rating = contains(RatingNumberField, {
    configuration: {
      presentation: {
        maxStars: 5,
      },
    },
  });

  // testing stock
  @field stock = contains(BasicNumberField);

  @field quantity = contains(QuantityNumberField, {
    configuration: function (this: TestingCardUseNumberField) {
      return {
        presentation: {
          min: 1,
          stock: this.stock,
        },
      };
    },
  });

  // @field pin = contains(PinNumberField, {
  //   configuration: {
  //     presentation: {
  //       length: 4,
  //     },
  //   },
  // });

  // @field phone = contains(PhoneNumberField, {
  //   configuration: {
  //     presentation: {
  //       placeholder: '(555) 123-4567',
  //     },
  //   },
  // });

  @field range = contains(NumberRange, {
    configuration: {
      presentation: {
        min: 0,
        max: 100,
        step: 5,
      },
    },
  });

  @field stat = contains(StatNumberField, {
    configuration: {
      presentation: {
        label: 'Total Revenue',
        prefix: '$',
        delta: 12.5,
        deltaDirection: 'down',
      },
    },
  });

  @field progressBar = contains(ProgressBarNumberField, {
    configuration: {
      presentation: {
        max: 100,
        label: 'Project Completion',
        helperText: '8 of 12 tasks completed',
      },
    },
  });

  @field progressCircle = contains(ProgressCircleNumberField, {
    configuration: {
      presentation: {
        max: 100,
        size: 200,
        label: 'Storage Used',
        helperText: '42.5 GB of 50 GB',
        strokeWidth: 15,
      },
    },
  });

  @field gauge = contains(GaugeNumberField, {
    configuration: {
      presentation: {
        max: 100,
        label: 'Performance Score',
        helperText: 'Use for scores and thresholds',
        strokeWidth: 15,
      },
    },
  });

  @field badge = contains(BadgeNumberField, {
    configuration: {
      presentation: {
        label: 'ITEMS:',
      },
    },
  });

  @field animatedCounter = contains(AnimatedCounterNumberField, {
    configuration: {
      presentation: {
        label: 'Downloads Today',
      },
    },
  });

  @field score = contains(ScoreNumberField, {
    configuration: {
      presentation: {
        label: 'Credit Score',
      },
    },
  });
}

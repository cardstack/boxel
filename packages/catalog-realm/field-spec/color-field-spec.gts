import {
  Spec,
  SpecHeader,
  SpecReadmeSection,
  ExamplesWithInteractive,
  SpecModuleSection,
} from 'https://cardstack.com/base/spec';
import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import ColorField from '../fields/color';
import CodeSnippet from '../components/code-snippet';

const standardFieldCode = `@field standard = contains(ColorField);`;
const wheelFieldCode = `@field wheel = contains(ColorField, {
  configuration: {
    variant: 'wheel',
  },
});`;
const sliderRgbFieldCode = `@field sliderRgb = contains(ColorField, {
  configuration: {
    variant: 'slider',
    options: {
      defaultFormat: 'rgb',
    },
  },
});`;
const sliderHslFieldCode = `@field sliderHsl = contains(ColorField, {
  configuration: {
    variant: 'slider',
    options: {
      defaultFormat: 'hsl',
    },
  },
});`;
const swatchesPickerFieldCode = `@field swatchesPicker = contains(ColorField, {
  configuration: {
    variant: 'swatches-picker',
  },
});`;
const advancedFieldCode = `@field advanced = contains(ColorField, {
  configuration: {
    variant: 'advanced',
  },
});`;
const withContrastCheckerFieldCode = `@field withContrastChecker = contains(ColorField, {
  configuration: {
    options: {
      showContrastChecker: true,
    },
  },
});`;

class ColorFieldSpecIsolated extends Component<typeof ColorFieldSpec> {
  <template>
    <article class='container'>
      <SpecHeader @model={{@model}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection @model={{@model}} @context={{@context}}>
        <@fields.readMe />
      </SpecReadmeSection>

      <ExamplesWithInteractive>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{standardFieldCode}} />
          <@fields.standard />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{wheelFieldCode}} />
          <@fields.wheel />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{sliderRgbFieldCode}} />
          <@fields.sliderRgb />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{sliderHslFieldCode}} />
          <@fields.sliderHsl />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{swatchesPickerFieldCode}} />
          <@fields.swatchesPicker />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{advancedFieldCode}} />
          <@fields.advanced />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withContrastCheckerFieldCode}} />
          <@fields.withContrastChecker />
        </article>
      </ExamplesWithInteractive>

      <SpecModuleSection @model={{@model}} />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .fields-configuration-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

class ColorFieldSpecEdit extends Component<typeof ColorFieldSpec> {
  <template>
    <article class='container'>
      <SpecHeader @model={{@model}} @isEditMode={{true}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection
        @model={{@model}}
        @context={{@context}}
        @isEditMode={{@canEdit}}
      >
        <@fields.readMe />
      </SpecReadmeSection>

      <ExamplesWithInteractive>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{standardFieldCode}} />
          <@fields.standard @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{wheelFieldCode}} />
          <@fields.wheel @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{sliderRgbFieldCode}} />
          <@fields.sliderRgb @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{sliderHslFieldCode}} />
          <@fields.sliderHsl @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{swatchesPickerFieldCode}} />
          <@fields.swatchesPicker @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{advancedFieldCode}} />
          <@fields.advanced @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{withContrastCheckerFieldCode}} />
          <@fields.withContrastChecker @format='edit' />
        </article>
      </ExamplesWithInteractive>

      <SpecModuleSection @model={{@model}} />
    </article>
    <style scoped>
      .container {
        --boxel-spec-background-color: #ebeaed;
        --boxel-spec-code-ref-background-color: #e2e2e2;
        --boxel-spec-code-ref-text-color: #646464;

        height: 100%;
        min-height: max-content;
        padding: var(--boxel-sp);
        background-color: var(--boxel-spec-background-color);
      }
      .fields-configuration-card {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

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

  static isolated = ColorFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = ColorFieldSpecEdit as unknown as typeof Spec.edit;
}

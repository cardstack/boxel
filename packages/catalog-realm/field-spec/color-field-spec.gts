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
  CardDef,
  BaseDef,
  getCardMeta,
} from 'https://cardstack.com/base/card-api';
import ColorField from '../fields/color';
import CodeSnippet from '../components/code-snippet';

import { action } from '@ember/object';
import { task } from 'ember-concurrency';
import { use, resource } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';
import { isPrimitive, loadCardDef } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common';
import GenerateReadmeSpecCommand from '@cardstack/boxel-host/commands/generate-readme-spec';

function myLoader(): Loader {
  // @ts-ignore
  return (import.meta as any).loader;
}

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
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }

  @action
  generateReadme() {
    this.generateReadmeTask.perform();
  }

  generateReadmeTask = task(async () => {
    if (!this.args.model) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      console.error('Command context not available');
      return;
    }

    try {
      const generateReadmeSpecCommand = new GenerateReadmeSpecCommand(
        commandContext,
      );
      await generateReadmeSpecCommand.execute({
        spec: this.args.model as Spec,
      });
    } catch (error) {
      console.error('Error generating README:', error);
    }
  });

  get icon() {
    return this.cardDef?.icon;
  }

  @use private loadCardDef = resource(() => {
    let cardDefObj = new TrackedObject<{ value: typeof BaseDef | undefined }>({
      value: undefined,
    });
    (async () => {
      try {
        if (this.args.model.ref && this.args.model.id) {
          let cardDef = await loadCardDef(this.args.model.ref, {
            loader: myLoader(),
            relativeTo: new URL(this.args.model.id),
          });
          cardDefObj.value = cardDef;
        }
      } catch (e) {
        cardDefObj.value = undefined;
      }
    })();
    return cardDefObj;
  });

  get cardDef() {
    return this.loadCardDef.value;
  }

  get isPrimitiveField() {
    return isPrimitive(this.cardDef);
  }

  private get realmInfo() {
    return getCardMeta(this.args.model as CardDef, 'realmInfo');
  }

  <template>
    <article class='container'>
      <SpecHeader @icon={{this.icon}} @defaultIcon={{this.defaultIcon}}>
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection>
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

      <SpecModuleSection
        @moduleHref={{@model.moduleHref}}
        @refName={{@model.ref.name}}
        @specType={{@model.specType}}
        @realmInfo={{this.realmInfo}}
      />
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
  get defaultIcon() {
    if (!this.args.model) {
      return;
    }
    return this.args.model.constructor?.icon;
  }

  @action
  generateReadme() {
    this.generateReadmeTask.perform();
  }

  generateReadmeTask = task(async () => {
    if (!this.args.model) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      console.error('Command context not available');
      return;
    }

    try {
      const generateReadmeSpecCommand = new GenerateReadmeSpecCommand(
        commandContext,
      );
      await generateReadmeSpecCommand.execute({
        spec: this.args.model as Spec,
      });
    } catch (error) {
      console.error('Error generating README:', error);
    }
  });

  get icon() {
    return this.cardDef?.icon;
  }

  @use private loadCardDef = resource(() => {
    let cardDefObject = new TrackedObject<{
      value: typeof BaseDef | undefined;
    }>({
      value: undefined,
    });
    (async () => {
      try {
        if (this.args.model.ref && this.args.model.id) {
          let cardDef = await loadCardDef(this.args.model.ref, {
            loader: myLoader(),
            relativeTo: new URL(this.args.model.id),
          });
          cardDefObject.value = cardDef;
        }
      } catch (e) {
        cardDefObject.value = undefined;
      }
    })();
    return cardDefObject;
  });

  get cardDef() {
    return this.loadCardDef.value;
  }

  get isPrimitiveField() {
    return isPrimitive(this.cardDef);
  }

  private get realmInfo() {
    return getCardMeta(this.args.model as CardDef, 'realmInfo');
  }

  <template>
    <article class='container'>
      <SpecHeader
        @icon={{this.icon}}
        @defaultIcon={{this.defaultIcon}}
        @isEditMode={{true}}
      >
        <:title><@fields.cardTitle /></:title>
        <:description><@fields.cardDescription /></:description>
      </SpecHeader>

      <SpecReadmeSection
        @canEdit={{@canEdit}}
        @onGenerateReadme={{this.generateReadme}}
        @isGenerating={{this.generateReadmeTask.isRunning}}
      >
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

      <SpecModuleSection
        @moduleHref={{@model.moduleHref}}
        @refName={{@model.ref.name}}
        @specType={{@model.specType}}
        @realmInfo={{this.realmInfo}}
      />
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

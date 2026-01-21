import {
  Spec,
  SpecHeader,
  SpecReadmeSection,
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
import DateField from '../fields/date';
import CodeSnippet from '../components/code-snippet';
import ExamplesWithInteractive from './components/examples-with-interactive';
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

const standardFieldCode = `@field standard = contains(DateField);`;
const compactFieldCode = `@field compact = contains(DateField, {
    configuration: {
      preset: 'tiny',
    },
  });`;
const customFormatFieldCode = `@field customFormat = contains(DateField, {
    configuration: {
      format: 'MMM D, YYYY',
    },
  });`;
const countdownFieldCode = `@field countdown = contains(DateField, {
    configuration: {
      presentation: 'countdown',
      countdownOptions: {
        label: 'Launch in',
        showControls: true,
      },
    },
  });`;
const timelineFieldCode = `@field timeline = contains(DateField, {
    configuration: {
      presentation: 'timeline',
      timelineOptions: {
        eventName: 'Release',
        status: 'active',
      },
    },
  });`;
const ageFieldCode = `@field age = contains(DateField, {
    configuration: {
      presentation: 'age',
      ageOptions: {
        showNextBirthday: true,
      },
    },
  });`;

class DateFieldSpecIsolated extends Component<typeof DateFieldSpec> {
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
          <CodeSnippet @code={{compactFieldCode}} />
          <@fields.compact />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{customFormatFieldCode}} />
          <@fields.customFormat />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{countdownFieldCode}} />
          <@fields.countdown />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{timelineFieldCode}} />
          <@fields.timeline />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{ageFieldCode}} />
          <@fields.age />
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

class DateFieldSpecEdit extends Component<typeof DateFieldSpec> {
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
          <@fields.standard @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{compactFieldCode}} />
          <@fields.compact @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{customFormatFieldCode}} />
          <@fields.customFormat @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{countdownFieldCode}} />
          <@fields.countdown @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{timelineFieldCode}} />
          <@fields.timeline @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{ageFieldCode}} />
          <@fields.age @format='edit' />
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

export class DateFieldSpec extends Spec {
  static displayName = 'Date Field Spec';

  // Standard DateField - default configuration
  @field standard = contains(DateField);

  // Compact preset - tiny preset for space-saving
  @field compact = contains(DateField, {
    configuration: {
      preset: 'tiny',
    },
  });

  // Custom format - custom date formatting
  @field customFormat = contains(DateField, {
    configuration: {
      format: 'MMM D, YYYY',
    },
  });

  // Countdown presentation with controls
  @field countdown = contains(DateField, {
    configuration: {
      presentation: 'countdown',
      countdownOptions: {
        label: 'Launch in',
        showControls: true,
      },
    },
  });

  // Timeline presentation with event data
  @field timeline = contains(DateField, {
    configuration: {
      presentation: 'timeline',
      timelineOptions: {
        eventName: 'Release',
        status: 'active',
      },
    },
  });

  // Age presentation highlighting next birthday
  @field age = contains(DateField, {
    configuration: {
      presentation: 'age',
      ageOptions: {
        showNextBirthday: true,
      },
    },
  });
  static isolated = DateFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = DateFieldSpecEdit as unknown as typeof Spec.edit;
}

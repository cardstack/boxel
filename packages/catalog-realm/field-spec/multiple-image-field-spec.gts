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
import MultipleImageField from '../fields/multiple-image';
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

const listFieldCode = `@field list = contains(MultipleImageField, {
    configuration: {
      variant: 'list',
      presentation: 'grid',
    },
  });`;
const galleryFieldCode = `@field gallery = contains(MultipleImageField, {
    configuration: {
      variant: 'gallery',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        allowReorder: true,
        maxFiles: 4,
        showProgress: true,
      },
    },
  });`;
const dropzoneFieldCode = `@field dropzone = contains(MultipleImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        showProgress: true,
        maxFiles: 10,
      },
    },
  });`;

class MultipleImageFieldSpecIsolated extends Component<
  typeof MultipleImageFieldSpec
> {
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
          <CodeSnippet @code={{listFieldCode}} />
          <@fields.list />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{galleryFieldCode}} />
          <@fields.gallery />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{dropzoneFieldCode}} />
          <@fields.dropzone />
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

class MultipleImageFieldSpecEdit extends Component<
  typeof MultipleImageFieldSpec
> {
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
          <CodeSnippet @code={{listFieldCode}} />
          <@fields.list @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{galleryFieldCode}} />
          <@fields.gallery @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{dropzoneFieldCode}} />
          <@fields.dropzone @format='edit' />
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

export class MultipleImageFieldSpec extends Spec {
  static displayName = 'Multiple Image Field Spec';

  // List variant - standard list view with grid display
  @field list = contains(MultipleImageField, {
    configuration: {
      variant: 'list',
      presentation: 'grid',
    },
  });

  // Gallery variant - grid edit with carousel display and reordering
  @field gallery = contains(MultipleImageField, {
    configuration: {
      variant: 'gallery',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        allowReorder: true,
        maxFiles: 4,
        showProgress: true,
      },
    },
  });

  // Dropzone variant - drag and drop multiple images with carousel
  @field dropzone = contains(MultipleImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        showProgress: true,
        maxFiles: 10,
      },
    },
  });
  static isolated =
    MultipleImageFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = MultipleImageFieldSpecEdit as unknown as typeof Spec.edit;
}

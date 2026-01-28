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
import ImageField from '../fields/image';
import CodeSnippet from '../components/code-snippet';

const browseFieldCode = `@field browse = contains(ImageField, {
    configuration: {
      variant: 'browse',
    },
  });`;
const avatarFieldCode = `@field avatar = contains(ImageField, {
    configuration: {
      variant: 'avatar',
      presentation: 'card',
      options: {
        showProgress: true,
      },
    },
  });`;
const dropzoneFieldCode = `@field dropzone = contains(ImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'inline',
      options: {
        showImageModal: true,
        showProgress: true,
      },
    },
  });`;

class ImageFieldSpecIsolated extends Component<typeof ImageFieldSpec> {
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
          <CodeSnippet @code={{browseFieldCode}} />
          <@fields.browse />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{avatarFieldCode}} />
          <@fields.avatar />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{dropzoneFieldCode}} />
          <@fields.dropzone />
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

class ImageFieldSpecEdit extends Component<typeof ImageFieldSpec> {
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
          <CodeSnippet @code={{browseFieldCode}} />
          <@fields.browse @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{avatarFieldCode}} />
          <@fields.avatar @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{dropzoneFieldCode}} />
          <@fields.dropzone @format='edit' />
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

export class ImageFieldSpec extends Spec {
  static displayName = 'Image Field Spec';

  // Browse variant
  @field browse = contains(ImageField, {
    configuration: {
      variant: 'browse',
    },
  });

  // Avatar variant
  @field avatar = contains(ImageField, {
    configuration: {
      variant: 'avatar',
      presentation: 'card',
      options: {
        showProgress: true,
      },
    },
  });

  // Dropzone variant
  @field dropzone = contains(ImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'inline',
      options: {
        showImageModal: true,
        showProgress: true,
      },
    },
  });

  static isolated = ImageFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = ImageFieldSpecEdit as unknown as typeof Spec.edit;
}

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
import MultipleImageField from '../fields/multiple-image';
import CodeSnippet from '../components/code-snippet';

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

class MultipleImageFieldSpecEdit extends Component<
  typeof MultipleImageFieldSpec
> {
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

export class MultipleImageFieldSpec extends Spec {
  static displayName = 'Multiple Image Field Spec';

  // List presentation
  @field list = contains(MultipleImageField, {
    configuration: {
      variant: 'list',
      presentation: 'grid',
    },
  });

  // Gallery presentation
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

  // Dropzone presentation
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

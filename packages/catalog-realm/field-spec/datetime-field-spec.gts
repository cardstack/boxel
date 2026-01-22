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
import DatetimeField from '../fields/date-time';
import CodeSnippet from '../components/code-snippet';

const standardFieldCode = `@field standard = contains(DatetimeField);`;
const shortFieldCode = `@field short = contains(DatetimeField, {
    configuration: {
      preset: 'short',
    },
  });`;
const customFormatFieldCode = `@field customFormat = contains(DatetimeField, {
    configuration: {
      format: 'ddd, MMM D [at] h:mm A',
    },
  });`;

class DatetimeFieldSpecIsolated extends Component<typeof DatetimeFieldSpec> {
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
          <CodeSnippet @code={{shortFieldCode}} />
          <@fields.short />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{customFormatFieldCode}} />
          <@fields.customFormat />
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

class DatetimeFieldSpecEdit extends Component<typeof DatetimeFieldSpec> {
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
          <CodeSnippet @code={{shortFieldCode}} />
          <@fields.short @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{customFormatFieldCode}} />
          <@fields.customFormat @format='edit' />
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

export class DatetimeFieldSpec extends Spec {
  static displayName = 'Datetime Field Spec';

  // Standard DatetimeField - default configuration
  @field standard = contains(DatetimeField);

  // Short format - compact datetime display
  @field short = contains(DatetimeField, {
    configuration: {
      preset: 'short',
    },
  });

  // Custom format - custom datetime formatting
  @field customFormat = contains(DatetimeField, {
    configuration: {
      format: 'ddd, MMM D [at] h:mm A',
    },
  });

  static isolated =
    DatetimeFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = DatetimeFieldSpecEdit as unknown as typeof Spec.edit;
}

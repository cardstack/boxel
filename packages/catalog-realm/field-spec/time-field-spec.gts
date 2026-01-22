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
import TimeField from '../fields/time';
import CodeSnippet from '../components/code-snippet';

const standardFieldCode = `@field standard = contains(TimeField);`;
const hour24FieldCode = `@field hour24 = contains(TimeField, {
    configuration: {
      hourCycle: 'h23',
    },
  });`;
const longStyleFieldCode = `@field longStyle = contains(TimeField, {
    configuration: {
      timeStyle: 'long',
    },
  });`;

class TimeFieldSpecIsolated extends Component<typeof TimeFieldSpec> {
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
          <CodeSnippet @code={{hour24FieldCode}} />
          <@fields.hour24 />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{longStyleFieldCode}} />
          <@fields.longStyle />
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

class TimeFieldSpecEdit extends Component<typeof TimeFieldSpec> {
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
          <CodeSnippet @code={{hour24FieldCode}} />
          <@fields.hour24 @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{longStyleFieldCode}} />
          <@fields.longStyle @format='edit' />
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

export class TimeFieldSpec extends Spec {
  static displayName = 'Time Field Spec';

  // Standard TimeField configuration
  @field standard = contains(TimeField);

  // 24-hour format
  @field hour24 = contains(TimeField, {
    configuration: {
      hourCycle: 'h23',
    },
  });

  // Long time style
  @field longStyle = contains(TimeField, {
    configuration: {
      timeStyle: 'long',
    },
  });

  static isolated = TimeFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = TimeFieldSpecEdit as unknown as typeof Spec.edit;
}

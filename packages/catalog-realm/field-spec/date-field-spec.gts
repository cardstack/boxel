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
import DateField from '../fields/date';
import CodeSnippet from '../components/code-snippet';

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

class DateFieldSpecEdit extends Component<typeof DateFieldSpec> {
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

export class DateFieldSpec extends Spec {
  static displayName = 'Date Field Spec';

  // Standard DateField - default configuration
  @field standard = contains(DateField);

  // Compact preset - tiny date chips
  @field compact = contains(DateField, {
    configuration: {
      preset: 'tiny',
    },
  });

  // Custom format - flexible date display
  @field customFormat = contains(DateField, {
    configuration: {
      format: 'MMM D, YYYY',
    },
  });

  // Countdown presentation
  @field countdown = contains(DateField, {
    configuration: {
      presentation: 'countdown',
      countdownOptions: {
        label: 'Launch in',
        showControls: true,
      },
    },
  });

  // Timeline presentation for events
  @field timeline = contains(DateField, {
    configuration: {
      presentation: 'timeline',
      timelineOptions: {
        eventName: 'Release',
        status: 'active',
      },
    },
  });

  // Age presentation
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

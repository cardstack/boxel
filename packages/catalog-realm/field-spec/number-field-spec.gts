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
import NumberField from '../fields/number';
import CodeSnippet from '../components/code-snippet';

const standardFieldCode = `@field standard = contains(NumberField);`;
const progressBarFieldCode = `@field progressBar = contains(NumberField, {
    configuration: {
      presentation: 'progress-bar',
    },
  });`;
const progressCircleFieldCode = `@field progressCircle = contains(NumberField, {
    configuration: {
      presentation: 'progress-circle',
    },
  });`;
const statFieldCode = `@field stat = contains(NumberField, {
    configuration: {
      presentation: 'stat',
    },
  });`;
const scoreFieldCode = `@field score = contains(NumberField, {
    configuration: {
      presentation: 'score',
    },
  });`;
const badgeNotificationFieldCode = `@field badgeNotification = contains(NumberField, {
    configuration: {
      presentation: 'badge-notification',
    },
  });`;
const badgeMetricFieldCode = `@field badgeMetric = contains(NumberField, {
    configuration: {
      presentation: 'badge-metric',
    },
  });`;
const badgeCounterFieldCode = `@field badgeCounter = contains(NumberField, {
    configuration: {
      presentation: 'badge-counter',
    },
  });`;
const gaugeFieldCode = `@field gauge = contains(NumberField, {
    configuration: {
      presentation: 'gauge',
    },
  });`;

class NumberFieldSpecIsolated extends Component<typeof NumberFieldSpec> {
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
          <CodeSnippet @code={{progressBarFieldCode}} />
          <@fields.progressBar />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{progressCircleFieldCode}} />
          <@fields.progressCircle />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{statFieldCode}} />
          <@fields.stat />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{scoreFieldCode}} />
          <@fields.score />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{badgeNotificationFieldCode}} />
          <@fields.badgeNotification />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{badgeMetricFieldCode}} />
          <@fields.badgeMetric />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{badgeCounterFieldCode}} />
          <@fields.badgeCounter />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{gaugeFieldCode}} />
          <@fields.gauge />
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

class NumberFieldSpecEdit extends Component<typeof NumberFieldSpec> {
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
          <CodeSnippet @code={{progressBarFieldCode}} />
          <@fields.progressBar @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{progressCircleFieldCode}} />
          <@fields.progressCircle @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{statFieldCode}} />
          <@fields.stat @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{scoreFieldCode}} />
          <@fields.score @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{badgeNotificationFieldCode}} />
          <@fields.badgeNotification @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{badgeMetricFieldCode}} />
          <@fields.badgeMetric @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{badgeCounterFieldCode}} />
          <@fields.badgeCounter @format='edit' />
        </article>
        <article class='fields-configuration-card'>
          <CodeSnippet @code={{gaugeFieldCode}} />
          <@fields.gauge @format='edit' />
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

export class NumberFieldSpec extends Spec {
  static displayName = 'Number Field Spec';

  // Standard NumberField configuration
  @field standard = contains(NumberField);

  // Progress bar presentation
  @field progressBar = contains(NumberField, {
    configuration: {
      presentation: 'progress-bar',
    },
  });

  // Progress circle presentation
  @field progressCircle = contains(NumberField, {
    configuration: {
      presentation: 'progress-circle',
    },
  });

  // Stat presentation
  @field stat = contains(NumberField, {
    configuration: {
      presentation: 'stat',
    },
  });

  // Score presentation
  @field score = contains(NumberField, {
    configuration: {
      presentation: 'score',
    },
  });

  // Badge notification presentation
  @field badgeNotification = contains(NumberField, {
    configuration: {
      presentation: 'badge-notification',
    },
  });

  // Badge metric presentation
  @field badgeMetric = contains(NumberField, {
    configuration: {
      presentation: 'badge-metric',
    },
  });

  // Badge counter presentation
  @field badgeCounter = contains(NumberField, {
    configuration: {
      presentation: 'badge-counter',
    },
  });

  // Gauge presentation
  @field gauge = contains(NumberField, {
    configuration: {
      presentation: 'gauge',
    },
  });

  static isolated = NumberFieldSpecIsolated as unknown as typeof Spec.isolated;
  static edit = NumberFieldSpecEdit as unknown as typeof Spec.edit;
}

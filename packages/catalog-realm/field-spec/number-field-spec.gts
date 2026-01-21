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
import NumberField from '../fields/number';
import CodeSnippet from '../components/code-snippet';
import ExamplesWithInteractive from './components/examples-with-interactive';
import LayoutList from '@cardstack/boxel-icons/layout-list';
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

      <section class='fields-configuration-preview section'>
        <header
          class='row-header'
          aria-labelledby='fields-configuration-preview'
        >
          <div class='row-header-left'>
            <LayoutList width='20' height='20' role='presentation' />
            <h2 id='fields-configuration-preview'>Field Usage Examples</h2>
          </div>
        </header>
        <div class='fields-configuration-grid'>
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
        </div>
      </section>

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
      .section {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--boxel-400);
      }
      h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .row-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-lg);
      }
      .row-header-left {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .fields-configuration-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .fields-configuration-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--boxel-sp);
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

export class NumberFieldSpec extends Spec {
  static displayName = 'Number Field Spec';

  // Standard NumberField - default configuration
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

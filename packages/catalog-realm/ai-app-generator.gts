import {
  type CardContext,
  Component,
} from 'https://cardstack.com/base/card-api';
import {
  CardContainer,
  FieldContainer,
  BoxelInput,
  Button,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import {
  baseRealm,
  isSingleCardDocument,
  type CodeRef,
  type LooseSingleCardDocument,
  type Query,
} from '@cardstack/runtime-common';
import { AppCard, AppCardTemplate, CardsGrid } from './app-card';
import CPU from '@cardstack/boxel-icons/cpu';

const getCardTypeQuery = (cardRef: CodeRef, excludedId?: string): Query => {
  let filter: Query['filter'];
  if (excludedId) {
    filter = {
      every: [{ type: cardRef }, { not: { eq: { id: excludedId } } }],
    };
  } else {
    filter = { type: cardRef };
  }
  return {
    filter,
    // sorting by title so that we can maintain stability in
    // the ordering of the search results (server sorts results
    // by order indexed by default)
    sort: [
      {
        on: {
          module: `${baseRealm.url}card-api`,
          name: 'CardDef',
        },
        by: 'title',
      },
    ],
  };
};

class HowToSidebar extends GlimmerComponent {
  <template>
    <aside class='intro'>
      <header>
        <div class='logo' />
        <h3 class='intro-title'>
          How to create your own app with AI in seconds
        </h3>
      </header>
      <div class='intro-content'>
        <p>
          Add a description of what you want, who it's for and any key features
          you need. We'll generate a product requirements document for you with
          the help of AI.
        </p>
        <p>
          Look for the AI assistant icon in the bottom right of the screen to
          see the assistant.
        </p>
      </div>
    </aside>
    <style scoped>
      h3,
      p {
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
      }
      .intro {
        width: 256px;
        height: max-content;
        min-height: 60%;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        border-radius: var(--boxel-border-radius-lg);
      }
      .intro-title {
        font-weight: 600;
        font-size: 1.5rem;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .logo {
        width: 40px;
        height: 40px;
        background: url('./ai-assist-icon@2x.webp') no-repeat center;
        background-size: contain;
        margin-bottom: var(--boxel-sp);
      }
      .intro-content {
        color: #ddd;
        line-height: 1.5;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .intro-list {
        list-style-type: disc;
        padding-left: var(--boxel-sp);
        font: var(--boxel-font-xs);
      }
      .intro-list > li + li {
        margin-top: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

class CardListSidebar extends GlimmerComponent<{
  title: string;
  query: Query;
  realms: string[];
  context?: CardContext;
}> {
  <template>
    <aside class='sidebar'>
      <header class='sidebar-header'>
        <h3 class='sidebar-title'>{{@title}}</h3>
      </header>
      <@context.prerenderedCardSearchComponent
        @query={{@query}}
        @format='fitted'
        @realms={{@realms}}
      >
        <:loading>Loading...</:loading>
        <:response as |cards|>
          <CardsGrid
            @cards={{cards}}
            @context={{@context}}
            @isListFormat={{true}}
          />
        </:response>
      </@context.prerenderedCardSearchComponent>
    </aside>
    <style scoped>
      .sidebar {
        width: 300px;
      }
      .sidebar-header {
        display: flex;
        align-items: center;
      }
      .sidebar-title {
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
        font: 700 var(--boxel-font);
        line-height: 2;
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
}

type Prompt = {
  appType: string;
  domain: string;
  customRequirements: string;
};

class PromptContainer extends GlimmerComponent<{
  prompt: Prompt;
  setPrompt: (key: string, value: string) => void;
  generateProductRequirementsDoc: () => void;
  isLoading: boolean;
}> {
  <template>
    <CardContainer @displayBoundaries={{true}} class='prompt-container'>
      <div class='prompt-container-options'>
        <button class='prompt-option active'>Start From Scratch</button>
        <button disabled class='prompt-option'>Remix an Existing App</button>
      </div>
      <section class='prompt-editor'>
        <FieldContainer @label='I want to make a'>
          <BoxelInput
            @value={{@prompt.appType}}
            @onInput={{fn @setPrompt 'appType'}}
          />
        </FieldContainer>
        <FieldContainer @label='Tailored for'>
          <BoxelInput
            @value={{@prompt.domain}}
            @onInput={{fn @setPrompt 'domain'}}
          />
        </FieldContainer>
        <FieldContainer class='features-field' @label='That has these features'>
          <BoxelInput
            @value={{@prompt.customRequirements}}
            @onInput={{fn @setPrompt 'customRequirements'}}
          />
        </FieldContainer>
        <Button
          class='generate-button'
          @kind='primary-dark'
          @loading={{@isLoading}}
          @disabled={{@isLoading}}
          {{on 'click' @generateProductRequirementsDoc}}
        >
          {{#unless @isLoading}}
            <span class='generate-button-logo' />
          {{/unless}}
          Let's Get Started
        </Button>
      </section>
    </CardContainer>
    <style scoped>
      .prompt-container {
        height: auto;
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl) var(--boxel-sp-xl);
      }
      .prompt-container-options {
        max-width: 650px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        justify-content: center;
        gap: var(--boxel-sp-lg);
        border-bottom: var(--boxel-border);
        margin: 0 auto var(--boxel-sp-xl);
      }
      .prompt-option {
        padding: var(--boxel-sp);
        background: none;
        border: none;
        font: 500 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .prompt-option.active,
      .prompt-option:hover:not(:disabled) {
        border-bottom: 4px solid var(--boxel-dark);
        font-weight: 600;
      }
      .prompt-editor {
        display: grid;
        gap: var(--boxel-sp);
      }
      .features-field {
        --boxel-input-height: 4rem;
      }
      .generate-button {
        --icon-size: 20px;
        --boxel-button-loading-icon-size: var(--icon-size);
        margin-top: var(--boxel-sp);
        padding: var(--boxel-sp-xxs) var(--boxel-sp);
        justify-self: end;
        gap: var(--boxel-sp-sm);
      }
      .generate-button :deep(svg) {
        width: var(--icon-size);
        height: var(--icon-size);
      }
      .generate-button :deep(.loading-indicator) {
        margin-right: 0;
      }
      .generate-button-logo {
        display: inline-block;
        width: var(--icon-size);
        height: var(--icon-size);
        background: url('./ai-assist-icon@2x.webp') no-repeat center;
        background-size: contain;
      }
    </style>
  </template>
}

class DashboardTab extends GlimmerComponent<{
  Args: {
    appCardId?: string;
    context?: CardContext;
    currentRealm?: URL;
    realms: string[];
    setActiveTab?: (tabId: string) => void;
  };
}> {
  <template>
    <div class='dashboard'>
      <HowToSidebar />
      <section>
        <header class='section-header'>
          <h2 class='section-title'>Generate an App</h2>
        </header>
        <PromptContainer
          @prompt={{this.prompt}}
          @setPrompt={{this.setPrompt}}
          @generateProductRequirementsDoc={{this.generateProductRequirementsDoc}}
          @isLoading={{this.generateRequirements.isRunning}}
        />
        {{#if this.errorMessage}}
          <p class='error'>{{this.errorMessage}}</p>
        {{/if}}
      </section>
      <CardListSidebar
        @title='Browse Sample Apps'
        @query={{getCardTypeQuery this.appCardRef @appCardId}}
        @realms={{@realms}}
        @context={{@context}}
      />
    </div>
    <style scoped>
      .dashboard {
        display: grid;
        grid-template-columns: auto minmax(400px, 1fr) auto;
        gap: var(--boxel-sp-xxl);
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
        overflow-x: auto;
      }
      .section-header {
        display: flex;
        align-items: center;
      }
      .section-title {
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
        font-weight: 600;
        font-size: 1.5rem;
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
  promptReset: Prompt = {
    appType: '',
    domain: '',
    customRequirements: '',
  };
  appCardRef = {
    name: 'AppCard',
    module: new URL('./app-card', import.meta.url).href,
  };
  prdCardRef = {
    name: 'ProductRequirementDocument',
    module: new URL('./product-requirement-document', import.meta.url).href,
  };
  @tracked errorMessage = '';
  @tracked prompt: Prompt = this.promptReset;

  @action setPrompt(key: string, value: string) {
    this.prompt = { ...this.prompt, [key]: value };
  }

  @action generateProductRequirementsDoc() {
    let requirements = this.prompt.customRequirements
      ? `that has these features: ${this.prompt.customRequirements}`
      : '';
    let prompt = `I want to make a ${this.prompt.appType} tailored for ${this.prompt.domain} ${requirements}`;
    this.generateRequirements.perform(prompt);
  }
  private generateRequirements = restartableTask(async (prompt: string) => {
    try {
      this.errorMessage = '';
      if (!this.args.context?.actions?.runCommand) {
        throw new Error('Missing required card context action');
      }
      // Update the runCommand call to use the constructed URL
      this.args.context.actions.runCommand(
        undefined,
        'https://cardstack.com/base/SkillCard/card-editing',
        `Generate product requirement document for prompt: "${prompt}"`,
      );
      this.prompt = this.promptReset;
      this.args.setActiveTab?.('requirements');
    } catch (e) {
      this.errorMessage =
        e instanceof Error ? `${e.name}: ${e.message}` : 'An error occurred.';
      throw e;
    }
  });
}

class RequirementsTab extends GlimmerComponent<{
  Args: {
    context?: CardContext;
    currentRealm?: URL;
    realms: string[];
  };
}> {
  <template>
    <div class='tab-content'>
      {{#if @context.actions.createCard}}
        <Button
          @kind='text-only'
          @loading={{this.isCreateCardRunning}}
          @disabled={{this.isCreateCardRunning}}
          class='create-new-button'
          {{on 'click' this.createNew}}
        >
          {{#unless this.isCreateCardRunning}}
            <IconPlus
              class='plus-icon'
              width='15'
              height='15'
              role='presentation'
            />
          {{/unless}}
          Create new requirement
        </Button>
      {{/if}}
      <div class='query-container'>
        <@context.prerenderedCardSearchComponent
          @query={{getCardTypeQuery this.cardRef}}
          @format='fitted'
          @realms={{@realms}}
        >
          <:loading>Loading...</:loading>
          <:response as |cards|>
            <CardsGrid @cards={{cards}} @context={{@context}} />
          </:response>
        </@context.prerenderedCardSearchComponent>
      </div>
    </div>
    <style scoped>
      .tab-content {
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
      }
      .query-container {
        padding: var(--boxel-sp);
      }
      .create-new-button {
        --boxel-button-loading-icon-size: 15px;
        --boxel-button-text-color: var(--boxel-dark);
        margin-left: var(--boxel-sp-sm);
        color: var(--boxel-dark);
        font-weight: 500;
        padding: var(--boxel-sp-xxs);
        gap: var(--boxel-sp-xxs);
      }
      .create-new-button :deep(.loading-indicator) {
        width: 15px;
        height: 15px;
        margin-right: 0;
      }
      .create-new-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
        color: var(--boxel-highlight);
      }
      .plus-icon {
        stroke-width: 0;
      }
    </style>
  </template>

  cardRef = {
    name: 'ProductRequirementDocument',
    module: new URL('./product-requirement-document', import.meta.url).href,
  };

  get isCreateCardRunning() {
    return this.createCard.isRunning;
  }

  @action createNew(value: unknown) {
    let cardDoc = isSingleCardDocument(value) ? value : undefined;
    this.createCard.perform(cardDoc);
  }

  private createCard = restartableTask(
    async (doc: LooseSingleCardDocument | undefined = undefined) => {
      try {
        if (!this.cardRef) {
          throw new Error('Can not create a card without a card ref.');
        }
        await this.args.context?.actions?.createCard?.(
          this.cardRef,
          this.args.currentRealm,
          { doc },
        );
      } catch (e) {
        throw e;
      }
    },
  );
}

class YourAppsTab extends GlimmerComponent<{
  Args: {
    appCardId?: string;
    context?: CardContext;
    currentRealm?: URL;
    realms: string[];
  };
}> {
  <template>
    <style scoped>
      .query-container {
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
      }
    </style>
  </template>

  cardRef = {
    name: 'AppCard',
    module: new URL('./app-card', import.meta.url).href,
  };
}

class Isolated extends Component<typeof AiAppGenerator> {
  <template>
    <AppCardTemplate @model={{@model}} @fields={{@fields}}>
      <:component as |args|>
        {{#if (eq args.activeTab.tabId 'dashboard')}}
          <DashboardTab
            @appCardId={{@model.id}}
            @context={{@context}}
            @currentRealm={{args.currentRealm}}
            @realms={{args.realms}}
            @setActiveTab={{args.setActiveTab}}
          />
        {{else if (eq args.activeTab.tabId 'requirements')}}
          <RequirementsTab
            @context={{@context}}
            @currentRealm={{args.currentRealm}}
            @realms={{args.realms}}
          />
        {{else}}
          <YourAppsTab
            @appCardId={{@model.id}}
            @context={{@context}}
            @currentRealm={{args.currentRealm}}
            @realms={{args.realms}}
          />
        {{/if}}
      </:component>
    </AppCardTemplate>
  </template>
}

export class AiAppGenerator extends AppCard {
  static displayName = 'AI App Generator';
  static icon = CPU;
  static prefersWideFormat = true;
  static headerColor = '#ffeb00';
  static isolated = Isolated;
}

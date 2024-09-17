import {
  type CardContext,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import {
  CardContainer,
  FieldContainer,
  BoxelInput,
  Button,
} from '@cardstack/boxel-ui/components';
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
import {
  AppCard,
  AppCardTemplate,
  CardsGrid,
  type TabComponentSignature,
} from './app-card';

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
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
          eiusmod tempor.
        </p>
        <p>
          <ul class='intro-list'>
            <li>Website</li>
            <li>CRM</li>
            <li>Scheduler</li>
            <li>Chess Game</li>
            <li>Music Instrument</li>
            <li>Generative Art</li>
          </ul>
        </p>
        <p>
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
          dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non
          proident, sunt in culpa qui officia deserunt mollit anim id est
          laborum.
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
        font-weight: 700;
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
      {{#let
        (component @context.prerenderedCardSearchComponent)
        as |PrerenderedCardSearch|
      }}
        <PrerenderedCardSearch
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
        </PrerenderedCardSearch>
      {{/let}}
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
        font-weight: 700;
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

class DashboardTab extends GlimmerComponent<TabComponentSignature> {
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
        @query={{this.query}}
        @realms={{this.realms}}
        @context={{@context}}
      />
    </div>
    <style scoped>
      .dashboard {
        display: grid;
        grid-template-columns: auto minmax(400px, 1fr) auto;
        gap: var(--boxel-sp-xxl);
        padding: var(--boxel-sp);
      }
      .section-header {
        display: flex;
        align-items: center;
      }
      .section-title {
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
        font-weight: 700;
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
    module: `${this.currentRealm?.href}app-card`,
  };
  prdCardRef = {
    name: 'ProductRequirementDocument',
    module: `${this.currentRealm?.href}product-requirement-document`,
  };
  @tracked errorMessage = '';
  @tracked prompt: Prompt = this.promptReset;

  get currentRealm() {
    return this.args.model?.[realmURL];
  }

  get realms() {
    return this.currentRealm ? [this.currentRealm.href] : [];
  }

  @action setPrompt(key: string, value: string) {
    this.prompt = { ...this.prompt, [key]: value };
  }

  @action generateProductRequirementsDoc() {
    let appTitle = `${this.prompt.domain} ${this.prompt.appType}`;
    let requirements = this.prompt.customRequirements
      ? `that has these features: ${this.prompt.customRequirements}`
      : '';
    let prompt = `I want to make a ${this.prompt.appType} tailored for a ${this.prompt.domain} ${requirements}`;
    this.generateRequirements.perform(this.prdCardRef, {
      data: {
        attributes: { appTitle, prompt },
        meta: { adoptsFrom: this.prdCardRef },
      },
    });
  }
  private generateRequirements = restartableTask(
    async (ref: CodeRef, doc: LooseSingleCardDocument) => {
      try {
        this.errorMessage = '';
        let { createCard, viewCard, runCommand } =
          this.args.context?.actions ?? {};
        if (!createCard || !viewCard || !runCommand) {
          this.errorMessage = 'Error: Missing required card actions';
          return;
        }
        let card = await createCard(ref, this.currentRealm, {
          doc,
          cardModeAfterCreation: 'isolated',
        });
        if (!card) {
          this.errorMessage = 'Error: Failed to create card';
          return;
        }
        await runCommand(
          card,
          `${baseRealm.url}SkillCard/generate-product-requirements`,
          'Generate product requirements document',
        );
        this.prompt = this.promptReset;
        // this.args.setActiveTab?.(1);
      } catch (e) {
        console.error(e);
        this.errorMessage =
          e instanceof Error ? `Error: ${e.message}` : 'An error occurred';
      }
    },
  );

  get query() {
    return {
      filter: {
        every: [
          { type: this.appCardRef },
          { not: { eq: { id: this.args.model.id! } } },
        ],
      },
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
  }
}

interface DefaultTabSignature extends TabComponentSignature {
  cardRef: CodeRef;
}

class DefaultTabTemplate extends GlimmerComponent<DefaultTabSignature> {
  <template>
    <div class='tab-content'>
      <@context.prerenderedCardSearchComponent
        @query={{this.query}}
        @format='fitted'
        @realms={{this.realms}}
      >
        <:loading>Loading...</:loading>
        <:response as |cards|>
          <CardsGrid @cards={{cards}} @context={{@context}} />
        </:response>
      </@context.prerenderedCardSearchComponent>
    </div>
    <style scoped>
      .tab-content {
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
      }
    </style>
  </template>

  get currentRealm() {
    return this.args.model?.[realmURL];
  }

  get realms() {
    return this.currentRealm ? [this.currentRealm.href] : [];
  }

  get query() {
    if (!this.args.cardRef) {
      return;
    }
    return {
      filter: {
        every: [
          { type: this.args.cardRef },
          { not: { eq: { id: this.args.model.id } } },
        ],
      },
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
  }
}

class RequirementsTab extends GlimmerComponent<TabComponentSignature> {
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
      <DefaultTabTemplate
        @model={{@model}}
        @context={{@context}}
        @cardRef={{this.cardRef}}
      />
    </div>
    <style scoped>
      .tab-content {
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
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
    module: `${this.currentRealm?.href}product-requirement-document`,
  };

  get currentRealm() {
    return this.args.model?.[realmURL];
  }

  get isCreateCardRunning() {
    return this.createCard.isRunning;
  }

  @action createNew(value: unknown) {
    let cardDoc = isSingleCardDocument(value) ? value : undefined;
    this.createCard.perform(cardDoc);
  }

  private createCard = restartableTask(
    async (doc: LooseSingleCardDocument | undefined = undefined) => {
      if (!this.cardRef) {
        return;
      }
      try {
        await this.args.context?.actions?.createCard?.(
          this.cardRef,
          this.currentRealm,
          { doc },
        );
      } catch (e) {
        console.error(e);
        throw new Error(e instanceof Error ? e.message : 'An error occurred');
      }
    },
  );
}

class YourAppsTab extends GlimmerComponent<TabComponentSignature> {
  <template>
    <DefaultTabTemplate
      @model={{@model}}
      @context={{@context}}
      @cardRef={{this.cardRef}}
    />
  </template>

  cardRef = {
    name: 'AppCard',
    module: `${this.currentRealm?.href}app-card`,
  };

  get currentRealm() {
    return this.args.model?.[realmURL];
  }
}

class Isolated extends AppCard.isolated {
  <template>
    <AppCardTemplate @model={{@model}} @fields={{@fields}}>
      <:component as |args|>
        Hi
        {{args.activeTabId}}
      </:component>
    </AppCardTemplate>
  </template>
}

export class AiAppGenerator extends AppCard {
  static displayName = 'AI App Generator';
  static prefersWideFormat = true;
  static headerColor = '#ffeb00';
  // static isolated = Isolated;
}

import type { CardDef, CardContext } from 'https://cardstack.com/base/card-api';
import {
  CardContainer,
  FieldContainer,
  BoxelInput,
  Button,
  TabbedHeader,
} from '@cardstack/boxel-ui/components';
import { and, bool, eq } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
// @ts-ignore
import { restartableTask } from 'ember-concurrency';
import type {
  CodeRef,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { AppCard, Tab, CardsGrid } from './app-card';

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
    <style>
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
  instances: CardDef[];
  context?: CardContext;
}> {
  <template>
    <aside class='sidebar'>
      <header class='sidebar-header'>
        <h3 class='sidebar-title'>{{@title}}</h3>
      </header>
      <CardsGrid
        @isListFormat={{true}}
        @instances={{@instances}}
        @context={{@context}}
      />
    </aside>
    <style>
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
          {{on 'click' @generateProductRequirementsDoc}}
        >
          {{#unless @isLoading}}
            <span class='generate-button-logo' />
          {{/unless}}
          Let's Get Started
        </Button>
      </section>
    </CardContainer>
    <style>
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

class Isolated extends AppCard.isolated {
  <template>
    <section class='app'>
      <TabbedHeader
        @title={{@model.title}}
        @tabs={{this.tabs}}
        @onSetActiveTab={{this.setActiveTab}}
        @activeTabIndex={{this.activeTabIndex}}
        @headerBackgroundColor={{this.headerColor}}
      >
        <:headerIcon>
          {{#if @model.headerIcon.base64}}
            <@fields.headerIcon />
          {{/if}}
        </:headerIcon>
      </TabbedHeader>
      <div class='app-content'>
        {{#if (eq this.activeTabIndex 0)}}
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
                @isLoading={{this.generatePrd.isRunning}}
              />
              {{#if this.errorMessage}}
                <p class='error'>{{this.errorMessage}}</p>
              {{/if}}
            </section>
            <CardListSidebar
              @title='Browse Sample Apps'
              @instances={{this.instances}}
              @context={{@context}}
            />
          </div>
        {{else}}
          {{#if
            (and (bool @context.actions.createCard) (eq this.activeTabIndex 1))
          }}
            <Button
              @kind='text-only'
              class='create-new-button'
              {{on 'click' this.createNew}}
            >
              <IconPlus
                class='plus-icon'
                width='15'
                height='15'
                role='presentation'
              />
              Create New
            </Button>
          {{/if}}
          <CardsGrid
            class='grid-cards'
            @instances={{this.instances}}
            @context={{@context}}
          />
        {{/if}}
      </div>
    </section>
    <style>
      .app {
        position: relative;
        min-height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .app-content {
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
      }
      .grid-cards {
        padding: var(--boxel-sp);
      }

      /* Dashboard */
      .dashboard {
        display: grid;
        grid-template-columns: auto minmax(400px, 1fr) auto;
        gap: var(--boxel-sp-xxl);
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

      /* Create New button */
      .create-new-button {
        margin-left: var(--boxel-sp-sm);
        color: var(--boxel-dark);
        font-weight: 500;
        padding: var(--boxel-sp-xxs);
        gap: var(--boxel-sp-xxs);
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

  @tracked tabs = [
    new Tab({
      displayName: 'Dashboard',
      tabId: 'dashboard',
      ref: {
        name: 'AppCard',
        module: `${this.currentRealm?.href}app-card`,
      },
    }),
    new Tab({
      displayName: 'Requirements',
      tabId: 'requirements',
      ref: {
        name: 'ProductRequirementDocument',
        module: `${this.currentRealm?.href}product-requirement-document`,
      },
    }),
    new Tab({
      displayName: 'Your Apps',
      tabId: 'your-apps',
      ref: {
        name: 'AppCard',
        module: `${this.currentRealm?.href}app-card`,
      },
    }),
  ];
  promptReset: Prompt = {
    appType: '',
    domain: '',
    customRequirements: '',
  };
  @tracked prompt: Prompt = this.promptReset;
  @action setPrompt(key: string, value: string) {
    this.prompt = { ...this.prompt, [key]: value };
  }
  @action generateProductRequirementsDoc() {
    let ref = this.tabs[1].ref;
    this.generatePrd.perform(ref, {
      data: {
        attributes: { prompt: this.prompt },
        meta: { adoptsFrom: ref },
      },
    });
  }
  private generatePrd = restartableTask(
    async (ref: CodeRef, doc: LooseSingleCardDocument) => {
      try {
        this.errorMessage = '';
        await this.args.context?.actions?.createCard?.(ref, this.currentRealm, {
          doc,
        });
        this.prompt = this.promptReset;
        this.setActiveTab(1);
      } catch (e) {
        console.error(e);
        this.errorMessage =
          e instanceof Error ? `Error: ${e.message}` : 'An error occurred';
      }
    },
  );
}

export class AiAppGenerator extends AppCard {
  static displayName = 'AI App Generator';
  static prefersWideFormat = true;
  static headerColor = '#ffeb00';
  static isolated = Isolated;
}

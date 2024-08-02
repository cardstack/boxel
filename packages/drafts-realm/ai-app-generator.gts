import { type CardDef } from 'https://cardstack.com/base/card-api';
import {
  CardContainer,
  FieldContainer,
  BoxelInput,
  Button,
  TabbedHeader,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { AppCard, Tab } from './app-card';

const getComponent = (card: CardDef) => {
  if (!card) {
    return;
  }
  return card.constructor.getComponent(card);
};

class Requirements extends GlimmerComponent<{
  instances: CardDef[] | [];
}> {
  <template>
    <div class='requirements'>
      <aside class='recent-reqs-sidebar'>
        <h3 class='recent-reqs-title'>Recent Requirements</h3>
        <ul>
          {{#each @instances as |doc|}}
            <li>
              <button {{on 'click' (fn this.openDoc doc)}}>
                {{doc.title}}
              </button>
            </li>
          {{/each}}
        </ul>
      </aside>
      {{#let (getComponent this.currentDoc) as |Card|}}
        <div class='requirements-doc'>
          <Card />
        </div>
      {{/let}}
    </div>
    <style>
      .requirements {
        height: 100%;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--boxel-sp);
      }
      .recent-reqs-sidebar {
        max-width: 235px;
      }
      .recent-reqs-title {
        margin: 0;
        font: 700 var(--boxel-font);
      }
      .requirements-doc > :deep(.field-component-card.embedded-format) {
        --overlay-embedded-card-header-height: 0;
      }
    </style>
  </template>

  @tracked _doc?: CardDef;

  @action openDoc(doc: CardDef) {
    this._doc = doc;
  }

  get currentDoc() {
    return this._doc ?? this.args.instances?.[0];
  }
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
        @iconURL={{if
          @model.headerIcon.iconURL
          @model.headerIcon.iconURL
          @model.thumbnailURL
        }}
        @iconBackgroundColor={{@model.headerIcon.backgroundColor}}
        @iconBorderColor={{@model.headerIcon.borderColor}}
        @iconCoversAllAvailableSpace={{@model.headerIcon.coversAllAvailableSpace}}
      />
      <div class='app-content'>
        {{#if (eq this.activeTabIndex 1)}}
          <Requirements @instances={{this.instances}} />
        {{else}}
          <div class='dashboard'>
            <aside class='intro'>
              <header>
                <div class='logo' />
                <h3 class='intro-title'>
                  How to create your own app with AI in seconds
                </h3>
              </header>
              <div class='intro-content'>
                <p>
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed
                  do eiusmod tempor.
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
                  Duis aute irure dolor in reprehenderit in voluptate velit esse
                  cillum dolore eu fugiat nulla pariatur. Excepteur sint
                  occaecat cupidatat non proident, sunt in culpa qui officia
                  deserunt mollit anim id est laborum.
                </p>
              </div>
            </aside>
            <section>
              <header class='db-content-header'>
                <h2 class='prompt-title'>Generate an App</h2>
              </header>
              <CardContainer @displayBoundaries={{true}} class='prompt'>
                <div class='prompt-options'>
                  <button class='prompt-option active'>Start From Scratch</button>
                  <button disabled class='prompt-option'>Remix an Existing App</button>
                </div>
                <section class='prd-editor'>
                  <FieldContainer @label='I want to make a'>
                    <BoxelInput
                      @value={{this.prompt.appType}}
                      @onInput={{fn this.setPrompt 'appType'}}
                    />
                  </FieldContainer>
                  <FieldContainer @label='Tailored for'>
                    <BoxelInput
                      @value={{this.prompt.domain}}
                      @onInput={{fn this.setPrompt 'domain'}}
                    />
                  </FieldContainer>
                  <FieldContainer
                    class='features'
                    @label='That has these features'
                  >
                    <BoxelInput
                      @value={{this.prompt.customRequirements}}
                      @onInput={{fn this.setPrompt 'customRequirements'}}
                    />
                  </FieldContainer>
                  <Button
                    class='generate-button'
                    @kind='primary-dark'
                    {{on 'click' this.generatePrd}}
                  >
                    <span class='button-logo' />
                    Let's Get Started
                  </Button>
                </section>
              </CardContainer>
            </section>
            <aside>
              <header class='db-content-header'>
                <h3 class='sample-apps-title'>Browse Sample Apps</h3>
              </header>
              <ul class='sample-apps-list'>
                {{#each this.instances key='id' as |card|}}
                  <li
                    class='sample-apps-list-item'
                    {{@context.cardComponentModifier
                      card=card
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                  >
                    {{#let (getComponent card) as |Card|}}
                      <Card />
                    {{/let}}
                  </li>
                {{/each}}
              </ul>
            </aside>
          </div>
        {{/if}}
      </div>
    </section>

    <style>
      h1,
      h2,
      h3,
      h4,
      h5,
      h6,
      p {
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
      }

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

      /* Dashboard */
      .db-content-header {
        display: flex;
        align-items: center;
      }

      .dashboard {
        display: grid;
        grid-template-columns: 256px minmax(400px, 1fr) 300px;
        gap: var(--boxel-sp-xxl);
      }

      .intro {
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
      .intro-list {
        list-style-type: disc;
        padding-left: var(--boxel-sp);
        font: var(--boxel-font-xs);
      }
      .intro-list > li + li {
        margin-top: var(--boxel-sp-xxs);
      }
      .intro-content {
        color: #ddd;
        line-height: 1.5;
        letter-spacing: var(--boxel-lsp-xs);
      }

      .prompt-title {
        font-weight: 700;
        font-size: 1.5rem;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .prompt {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl) var(--boxel-sp-xl);
      }
      .prompt-options {
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
      .prd-editor {
        display: grid;
        gap: var(--boxel-sp);
      }
      .generate-button {
        margin-top: var(--boxel-sp);
        justify-self: end;
      }
      .features {
        --boxel-input-height: 4rem;
      }
      .button-logo {
        display: inline-block;
        width: 20px;
        height: 20px;
        background: url('./ai-assist-icon@2x.webp') no-repeat center;
        background-size: contain;
        margin-right: var(--boxel-sp-sm);
      }

      .sample-apps-title {
        font: 700 var(--boxel-font);
        line-height: 2;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .sample-apps-list {
        list-style-type: none;
        margin: 0;
        padding: 0;
      }
      .sample-apps-list-item {
        height: 260px;
      }
      .sample-apps-list-item + .sample-apps-list-item {
        margin-top: var(--boxel-sp-xs);
      }
      .sample-apps-list-item > :deep(.field-component-card.embedded-format) {
        --overlay-embedded-card-header-height: 0;
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
  ];
  @tracked prompt?: {
    appType: string;
    domain: string;
    customRequirements: string;
  } = undefined;

  @action setPrompt(key: string, value: string) {
    let prompt = this.prompt ?? {
      appType: '',
      domain: '',
      customRequirements: '',
    };
    this.prompt = { ...prompt, [key]: value };
  }

  @action generatePrd() {
    if (!this.activeTabRef) {
      console.error('No active tab ref');
      return;
    }
    this.setActiveTab(1);
    this.createNew?.({
      data: {
        attributes: { prompt: this.prompt },
        meta: { adoptsFrom: this.activeTabRef },
      },
    });
    this.prompt = undefined;
  }
}

export class AiAppGenerator extends AppCard {
  static displayName = 'AI App Generator';
  static prefersWideFormat = true;
  static headerColor = '#ffeb00';
  static isolated = Isolated;
}

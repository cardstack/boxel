import {
  CardDef,
  Component,
  FieldDef,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { CardContainer } from '@cardstack/boxel-ui/components';
import { cssVar, eq } from '@cardstack/boxel-ui/helpers';
import { getLiveCards } from '@cardstack/runtime-common';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
// @ts-ignore
import cssUrl from 'ember-css-url';
import {
  Prompt,
  ProductRequirementDocument,
} from './product-requirement-document';
import { AppCard } from './app-card';

class RequirementsEmbedded extends Component<typeof Requirements> {
  <template>
    <div class='requirements'>
      <aside class='recent-reqs-sidebar'>
        <h3 class='recent-reqs-title'>Recent Requirements</h3>
        <ul>
          {{#each this.instances as |doc|}}
            <li>
              <button {{on 'click' (fn this.openDoc doc)}}>
                {{doc.title}}
              </button>
            </li>
          {{/each}}
        </ul>
      </aside>
      <div>
        <@fields.document />
      </div>
    </div>
    <style>
      .requirements {
        height: inherit;
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
    </style>
  </template>

  @tracked
  private declare liveQuery: {
    instances: ProductRequirementDocument[];
    isLoading: boolean;
  };

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.liveQuery = getLiveCards({
      filter: {
        type: {
          name: 'ProductRequirementDocument',
          module: 'http://localhost:4201/drafts/product-requirement-document',
        },
      },
    }) as { instances: ProductRequirementDocument[]; isLoading: boolean };
  }

  get instances() {
    let instances = this.liveQuery?.instances;
    this.args.model.recentRequirements = instances;
    return instances;
  }

  @action openDoc(doc: ProductRequirementDocument) {
    this.args.model.document = doc;
  }
}

class Requirements extends FieldDef {
  static displayName = 'Requirements';
  @field document = linksTo(ProductRequirementDocument);
  @field recentRequirements = linksToMany(ProductRequirementDocument);
  static embedded = RequirementsEmbedded;
}

class Isolated extends AppCard.isolated {
  tabs = ['Dashboard' /*, 'Requirements', 'Your Apps', 'Sample Apps'*/];
  <template>
    <section class='app'>
      <header
        class='app-header'
        style={{cssVar db-header-bg-color=this.headerColor}}
      >
        <div class='app-title-group'>
          <h1 class='app-title'><@fields.title /></h1>
        </div>
        <nav class='app-nav'>
          <ul class='app-tab-list'>
            {{#each this.tabs as |tab index|}}
              <li>
                <a
                  {{on 'click' (fn this.setActiveTab index)}}
                  class={{if (eq this.activeTabIndex index) 'active'}}
                >
                  {{tab}}
                </a>
              </li>
            {{/each}}
          </ul>
        </nav>
      </header>
      <div class='app-content'>
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
                Duis aute irure dolor in reprehenderit in voluptate velit esse
                cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat
                cupidatat non proident, sunt in culpa qui officia deserunt
                mollit anim id est laborum.
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
              <@fields.prompt @format='edit' />
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
                  {{#let (this.getEmbeddedComponent card) as |EmbeddedCard|}}
                    <EmbeddedCard />
                  {{/let}}
                </li>
              {{/each}}
            </ul>
          </aside>
        </div>
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
      ul {
        list-style-type: none;
        margin: 0;
        padding: 0;
      }
      ul > li + li {
        margin-top: var(--boxel-sp-xs);
      }

      .app {
        position: relative;
        min-height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--db-bg-color, var(--boxel-light));
        color: var(--db-color, var(--boxel-dark));
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .app-header {
        padding: 0 var(--boxel-sp-lg);
        background-color: var(--db-header-bg-color, var(--boxel-light));
        color: var(--db-header-color, var(--boxel-dark));
      }
      .app-title-group {
        padding: var(--boxel-sp-xs) 0;
        display: flex;
        align-items: center;
      }
      .app-title {
        margin: 0;
        font: 900 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .app-nav {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .app-tab-list {
        width: 520px;
        display: grid;
        gap: var(--boxel-sp);
        grid-template-columns: repeat(4, minmax(90px, 1fr));
        justify-items: center;
        margin-left: -10px;
      }
      .app-tab-list > li + li {
        margin-top: 0;
      }
      .app-tab-list a {
        padding: var(--boxel-sp-xs) var(--boxel-sp-xxs);
      }
      .app-tab-list a.active,
      .app-tab-list a:hover:not(:disabled) {
        color: var(--db-header-color, var(--boxel-dark));
        border-bottom: 4px solid var(--db-header-color, var(--boxel-dark));
        font-weight: 700;
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
        border-bottom: 4px solid var(--db-header-color, var(--boxel-dark));
        font-weight: 700;
      }

      .sample-apps-title {
        font: 700 var(--boxel-font);
        line-height: 2;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .sample-apps-list-item {
        height: 260px;
      }
      .sample-apps-list-item > :deep(.field-component-card.embedded-format) {
        --overlay-embedded-card-header-height: 0;
      }
    </style>
  </template>

  constructor(owner: Owner, args: any) {
    super(owner, args);
    // this.args.model.tabs = this.tabs;
    if (this.currentRealm) {
      let query = {
        filter: {
          type: {
            name: 'AppCard',
            module: `${this.currentRealm?.href}app-card`,
          },
        },
      };
      this.setSearch(query);
    }
  }

  get currentTabName() {
    return this.tabs[this.activeTabIndex];
  }

  getEmbeddedComponent(card: CardDef) {
    if (!card) {
      return;
    }
    return card.constructor.getComponent(card);
  }
}

export class AiAppGenerator extends AppCard {
  static displayName = 'AI App Generator';
  static prefersWideFormat = true;
  static headerColor = '#ffeb00';
  @field prompt = contains(Prompt);
  static isolated = Isolated;
}

import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { eq } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { Prompt } from './product-requirement-document';

class Isolated extends Component<typeof AiAppGenerator> {
  tabs = [
    {
      name: 'Dashboard',
      id: 'dashboard',
    },
    {
      name: 'Requirements',
      id: 'requirements',
    },
    {
      name: 'Your Apps',
      id: 'your-apps',
    },
    {
      name: 'Sample Apps',
      id: 'sample-apps',
    },
  ];
  <template>
    <section class='main'>
      <header class='header'>
        <h1 class='title'><@fields.title /></h1>
        <nav class='nav'>
          <ul class='tab-list'>
            {{#each this.tabs as |tab|}}
              <li>
                <a
                  {{on 'click' (fn this.setActiveTab tab.id)}}
                  class={{if (eq this.activeTabId tab.id) 'active'}}
                >
                  {{tab.name}}
                </a>
              </li>
            {{/each}}
          </ul>
        </nav>
      </header>
      {{#if (eq this.activeTabId 'requirements')}}
        <div class='content requirements'>
          <aside class='reqs-sidebar'>
            <h3>Recent Requirements</h3>
          </aside>
          <div>
            {{! Requirements doc }}
          </div>
        </div>
      {{else if (eq this.activeTabId 'your-apps')}}
        <div class='content'>
          <h2>Your Apps</h2>
        </div>
      {{else if (eq this.activeTabId 'sample-apps')}}
        <div class='content'>
          <h2>Sample Apps</h2>
        </div>
      {{else}}
        <div class='content dashboard'>
          <aside class='intro-sidebar'>
            <h3>
              How to create your own app with AI in seconds
            </h3>
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
              eiusmod tempor.</p>
          </aside>
          <div class='prompt-generation'>
            <h2>Generate an App</h2>
            <div class='prompt-container'>
              <@fields.prompt @format='edit' />
            </div>
          </div>
          <aside class='sample-app-sidebar'>
            <h4>Browse Sample Apps</h4>
          </aside>
        </div>
      {{/if}}
    </section>

    <style>
      .main {
        display: grid;
        grid-template-rows: auto 1fr;
        height: 100%;
      }
      .header {
        --db-header-color: var(--boxel-dark);
        --db-header-bg-color: var(--boxel-yellow);
        padding-right: var(--boxel-sp-lg);
        padding-left: var(--boxel-sp-lg);
        background-color: var(--db-header-bg-color);
        color: var(--db-header-color);
      }
      .title {
        margin: 0;
        padding-top: var(--boxel-sp-lg);
        padding-bottom: var(--boxel-sp-xs);
        font: 900 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .nav {
        font: var(--boxel-font-sm);
      }
      .tab-list {
        list-style-type: none;
        margin: 0;
        display: grid;
        grid-template-columns: 90px 105px 80px 100px;
        gap: var(--boxel-sp);
        padding: 0;
      }
      .tab-list a {
        display: inline-block;
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp-xs) 5px;
      }
      .tab-list a.active {
        border-bottom: 4px solid var(--db-header-color);
        font-weight: 700;
      }
      .tab-list a:hover {
        color: var(--db-header-color);
        border-bottom: 4px solid var(--db-header-color);
        font-weight: 700;
      }
      .dashboard {
        display: grid;
        grid-template-columns: 1fr 3fr 1fr;
        gap: var(--boxel-sp);
      }

      .content {
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
      }

      .intro-sidebar {
        max-width: 256px;
        height: max-content;
        min-height: 70%;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        padding: var(--boxel-sp-lg);
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        letter-spacing: var(--boxel-lsp);
        border-radius: var(--boxel-border-radius-lg);
      }
      .intro-sidebar > h3 {
        margin: 0;
        font-weight: 700;
        font-size: 1.5rem;
      }
      .intro-sidebar p {
        margin: 0;
      }

      .prompt-generation > h2 {
        margin: 0;
        font-weight: 700;
        font-size: 1.5rem;
      }
      .prompt-container {
        margin-top: var(--boxel-sp);
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp-xl);
        background-color: var(--boxel-light);
      }

      .sample-app-sidebar {
        max-width: 300px;
      }
      .sample-app-sidebar > h4 {
        margin: 0;
        font: 700 var(--boxel-font);
      }

      .requirements {
        display: grid;
        grid-template-columns: auto 1fr;
      }
    </style>
  </template>

  @tracked activeTabId = this.tabs[0].id;

  @action setActiveTab(tabId: string) {
    this.activeTabId = tabId;
  }
}

export class AiAppGenerator extends CardDef {
  static displayName = 'AI App Generator';
  static prefersWideFormat = true;
  @field prompt = contains(Prompt);

  static isolated = Isolated;

  /*
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }


































  */
}

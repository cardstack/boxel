import {
  Component,
  FieldDef,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { eq } from '@cardstack/boxel-ui/helpers';
import { getLiveCards } from '@cardstack/runtime-common';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import {
  Prompt,
  ProductRequirementDocument,
} from './product-requirement-document';
import { AppCard } from './app-card';

class Dashboard extends FieldDef {
  static displayName = 'Dashboard';
  @field prompt = contains(Prompt);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='dashboard'>
        <aside class='intro-sidebar'>
          <h3>
            How to create your own app with AI in seconds
          </h3>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
            eiusmod tempor.
          </p>
        </aside>
        <div>
          <h2 class='prompt-title'>Generate an App</h2>
          <div class='prompt-container'>
            <@fields.prompt @format='edit' />
          </div>
        </div>
        <aside class='sample-app-sidebar'>
          <h4 class='sample-app-title'>Browse Sample Apps</h4>
        </aside>
      </div>
      <style>
        .dashboard {
          display: grid;
          grid-template-columns: 1fr 3fr 1fr;
          gap: var(--boxel-sp);
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

        .prompt-title {
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
        .sample-app-title {
          margin: 0;
          font: 700 var(--boxel-font);
        }
      </style>
    </template>
  };
}

class RequirementsEmbedded extends Component<typeof Requirements> {
  <template>
    <div class='requirements'>
      <aside class='reecent-reqs-sidebar'>
        <h3 class='reecent-reqs-title'>Recent Requirements</h3>
        <ul>
          {{#each this.instances as |doc|}}
            <li><button
                {{on 'click' (fn this.openDoc doc)}}
              >{{doc.title}}</button></li>
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
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
      }
      .reecent-reqs-sidebar {
        max-width: 235px;
      }
      .reecent-reqs-title {
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
  tabs = ['dashboard', 'requirements'];
  <template>
    <section class='main'>
      <header class='header'>
        <h1 class='title'><@fields.title /></h1>
        <nav class='nav'>
          <ul class='tab-list'>
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
      <div class='content'>
        {{#if (eq this.currentTabName 'requirements')}}
          <@fields.requirements />
        {{else}}
          <@fields.dashboard />
        {{/if}}
      </div>
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
      .content {
        padding: var(--boxel-sp);
        background-color: #f7f7f7;
      }
      .content > div {
        height: 100%;
      }
    </style>
  </template>

  get currentTabName() {
    return this.tabs[this.activeTabIndex];
  }
}

export class AiAppGenerator extends AppCard {
  static displayName = 'AI App Generator';
  static prefersWideFormat = true;
  static headerColor = '#ffeb00';
  @field dashboard = contains(Dashboard);
  @field requirements = contains(Requirements);
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

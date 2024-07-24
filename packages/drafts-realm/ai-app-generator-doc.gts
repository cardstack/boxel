import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
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

export class Dashboard extends CardDef {
  static displayName = 'Dashboard';
  static prefersWideFormat = true;
  @field prompt = contains(Prompt);

  static isolated = class Isolated extends Component<typeof this> {
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

class RequirementsTemplate extends Component<typeof Requirements> {
  <template>
    <div class='requirements'>
      <aside class='recent-reqs-sidebar'>
        <h3 class='recent-reqs-title'>Recent Requirements</h3>
        <ul>
          <@fields.recentRequirements />
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
      .recent-reqs-sidebar {
        max-width: 235px;
      }
      .recent-reqs-title {
        margin: 0;
        font: 700 var(--boxel-font);
      }
    </style>
  </template>

  // @tracked
  // private declare prdLiveQuery: {
  //   instances: ProductRequirementDocument[];
  //   isLoading: boolean;
  // };

  // constructor(owner: Owner, args: any) {
  //   super(owner, args);
  //   this.prdLiveQuery = getLiveCards({
  //     filter: {
  //       type: {
  //         name: 'ProductRequirementDocument',
  //         module: 'product-requirement-document',
  //       },
  //     },
  //   }) as { instances: ProductRequirementDocument[]; isLoading: boolean };
  // }

  // get prdInstances() {
  //   let instances = this.prdLiveQuery?.instances;
  //   this.args.model.recentRequirements = instances;
  //   return instances;
  // }

  @action openDoc(doc: ProductRequirementDocument) {
    this.args.model.document = doc;
  }
}

export class Requirements extends CardDef {
  static displayName = 'Requirements';
  @field document = linksTo(ProductRequirementDocument);
  @field recentRequirements = linksToMany(ProductRequirementDocument);
  static isolated = RequirementsTemplate;
}

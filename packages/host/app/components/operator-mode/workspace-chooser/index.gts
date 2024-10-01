import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import RealmServerService from '@cardstack/host/services/realm-server';

import AddWorkspace from './add-workspace';
import Workspace from './workspace';

interface Signature {
  Element: HTMLDivElement;
  Args: {};
}

export default class WorkspaceChooser extends Component<Signature> {
  @service declare realmServer: RealmServerService;

  private get displayCatalogWorkspaces() {
    return (
      this.realmServer.catalogRealmURLs &&
      this.realmServer.catalogRealmURLs.length > 0
    );
  }

  <template>
    <div class='workspace-chooser' data-test-workspace-chooser>
      <div class='workspace-chooser__content'>
        <span class='workspace-chooser__title'>Your Workspaces</span>
        <div class='workspace-list' data-test-workspace-list>
          {{#each this.realmServer.userRealmURLs as |realmURL|}}
            <Workspace
              @realmURL={{realmURL}}
              data-test-workspace={{realmURL}}
            />
          {{/each}}
          <AddWorkspace />
        </div>
        {{#if this.displayCatalogWorkspaces}}
          <span class='workspace-chooser__title'>Community Catalogs</span>
          <div class='workspace-list' data-test-catalog-list>
            {{#each this.realmServer.catalogRealmURLs as |realmURL|}}
              <Workspace @realmURL={{realmURL}} />
            {{/each}}
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .workspace-chooser {
        opacity: 0;
        position: relative;
        background-color: var(--boxel-700);
        height: 100vh;
        padding: 5.5rem 11.5rem;
        animation: fadeIn 1s ease-in forwards;
      }
      .workspace-chooser__content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        height: 100%;
        overflow: auto;
      }
      .workspace-chooser__title {
        color: var(--boxel-light);
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp);
      }
      .workspace-chooser__title:last-of-type {
        margin-top: var(--boxel-sp-lg);
      }

      .workspace-list {
        display: flex;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-xs) 0;
        overflow: auto hidden;
        min-height: 255px;
      }
    </style>
  </template>
}

import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import type CardService from '@cardstack/host/services/card-service';

import Workspace from './workspace';

interface Signature {
  Element: HTMLDivElement;
  Args: {};
}

export default class WorkspaceChooser extends Component<Signature> {
  @service declare cardService: CardService;

  <template>
    <div class='workspace-chooser' data-test-workspace-chooser>
      <span class='workspace-chooser__title'>Your Workspaces</span>
      <div class='workspace-list' data-test-personal-workspaces>
        {{#each this.cardService.userRealms as |realmURL|}}
          <Workspace @realmURL={{realmURL}} />
        {{/each}}
      </div>
      {{! TODO: [CS-7199] Include "Community Catalogs" if there are catalogs to show }}
      <span class='workspace-chooser__title'>Community Catalogs</span>
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
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        position: relative;
        background-color: var(--boxel-700);
        height: 100%;
        padding: 10rem 11.5rem;
        animation: fadeIn 1s ease-in forwards;
      }
      .workspace-chooser__title {
        color: var(--boxel-light);
        font: 600 var(--boxel-font-lg);
        letter-spacing: var(--boxel-lsp);
      }

      .workspace-list {
        display: flex;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-xs) 0;
        overflow: auto;
      }
    </style>
  </template>
}

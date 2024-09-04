import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import type CardService from '@cardstack/host/services/card-service';
interface Signature {
  Element: HTMLDivElement;
  Args: {};
}

export default class WorkspaceChooser extends Component<Signature> {
  @service declare cardService: CardService;

  <template>
    <div class='workspace-chooser' data-test-workspace-chooser>
      <span class='workspace-chooser__title'>Your Workspaces</span>
      <ul>
        {{#each this.cardService.unresolvedRealmURLs as |realmURL|}}
          <li class='workspace' data-test-workspace>{{realmURL}}</li>
        {{/each}}
      </ul>
      {{! TODO: [CS-7031] Implement list workspaces that user has access to }}
      <span class='workspace-chooser__title'>Community Catalogs</span>
    </div>
    <style>
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

      .workspace {
        /* placeholder style only */
        color: var(--boxel-light);
      }
    </style>
  </template>
}

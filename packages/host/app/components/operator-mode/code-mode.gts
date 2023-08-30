import Component from '@glimmer/component';
import { service } from '@ember/service';
import MonacoService from '@cardstack/host/services/monaco-service';
import { trackedFunction } from 'ember-resources/util/function';
import CardService from '@cardstack/host/services/card-service';
import { htmlSafe } from '@ember/template';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import ENV from '@cardstack/host/config/environment';
import FileTree from '../editor/file-tree';
const { ownRealmURL } = ENV;

interface Signature {
  Args: {
    card: CardDef;
    controller: CardController;
  };
}

export default class CodeMode extends Component<Signature> {
  @service declare monacoService: MonacoService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;

  fetchRealmInfo = trackedFunction(this, async () => {
    let realmInfo = await this.cardService.getRealmInfo(this.args.card);
    return realmInfo;
  });

  get backgroundURL() {
    return this.fetchRealmInfo.value?.backgroundURL;
  }

  get backgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.backgroundURL});`);
  }

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>

    <div class='code-mode' data-test-code-mode>
      <div class='columns'>
        <div class='column'>
          {{! Move each container and styles to separate component }}
          <div class='inner-container'>
            Inheritance / File Browser
            <section class='inner-container__content'>
              <FileTree
                @url={{ownRealmURL}}
                @openFiles={{@controller.codeParams}}
              />
            </section>
          </div>
          <aside class='inner-container'>
            <header class='inner-container__header'>
              Recent Files
            </header>
            <section class='inner-container__content'></section>
          </aside>
        </div>
        <div class='column'>
          <div class='inner-container'>
            Code
          </div>
        </div>
        <div class='column'>
          <div class='inner-container'>
            Schema Editor
          </div>
        </div>
      </div>
    </div>

    <style>
      :global(:root) {
        --code-mode-padding-top: calc(
          var(--submode-switcher-trigger-height) + (2 * (var(--boxel-sp)))
        );
        --code-mode-padding-bottom: calc(
          var(--search-sheet-closed-height) + (var(--boxel-sp))
        );
        --code-mode-column-min-width: calc(
          var(--operator-mode-min-width) - 2 * var(--boxel-sp)
        );
      }

      .code-mode {
        height: 100%;
        max-height: 100vh;
        left: 0;
        right: 0;
        z-index: 1;
        padding: var(--code-mode-padding-top) var(--boxel-sp)
          var(--code-mode-padding-bottom);
        overflow: auto;
      }

      .code-mode-background {
        position: fixed;
        left: 0;
        right: 0;
        display: block;
        width: 100%;
        height: 100%;
        filter: blur(15px);
        background-size: cover;
      }

      .columns {
        display: flex;
        flex-direction: row;
        flex-shrink: 0;
        gap: var(--boxel-sp-lg);
        height: 100%;
      }
      .column {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-width: var(--code-mode-column-min-width);
      }
      .column:nth-child(2) {
        flex: 2;
      }
      .column:last-child {
        flex: 1.2;
      }
      .column:first-child > *:first-child {
        max-height: 50%;
        background-color: var(--boxel-200);
      }
      .column:first-child > *:last-child {
        max-height: calc(50% - var(--boxel-sp));
        background-color: var(--boxel-200);
      }

      .inner-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
      }
      .inner-container__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .inner-container__content {
        padding: 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
      }
    </style>
  </template>
}

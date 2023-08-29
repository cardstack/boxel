import Component from '@glimmer/component';
import { service } from '@ember/service';
import MonacoService from '@cardstack/host/services/monaco-service';
import { trackedFunction } from 'ember-resources/util/function';
import CardService from '@cardstack/host/services/card-service';
import { htmlSafe } from '@ember/template';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: CardDef;
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
          {{! Move container and styles to separate component }}
          <div class='file-browser'>
            <header class='file-browser__header'>
              Inheritance / File Browser
            </header>
            <section class='file-browser__content'></section>
          </div>

          {{! Move container and styles to separate component }}
          <aside class='recent-files'>
            <header class='recent-files__header'>Recent Files</header>
            <section class='recent-files__content'></section>
          </aside>
        </div>
        <div class='column'>
          {{! Move container and styles to separate component }}
          <div class='code-editor'>
            Code
          </div>
        </div>
        <div class='column'>
          {{! Move container and styles to separate component }}
          <div class='schema-editor'>
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
        left: 0;
        right: 0;
        z-index: 1;
        padding: var(--code-mode-padding-top) var(--boxel-sp)
          var(--code-mode-padding-bottom);
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
        flex-wrap: wrap;
        gap: var(--boxel-sp-lg);
        height: 100%;
      }

      .column {
        flex: 1;
        display: grid;
        gap: var(--boxel-sp);
        min-width: var(--code-mode-column-min-width);
      }

      .column:first-child {
        flex: 0.3;
      }

      .column:last-child {
        flex: 0.6;
      }

      .file-browser {
        height: 100%;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .file-browser__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        background-color: var(--boxel-200);
      }
      .file-browser__content {
        padding: 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
      }

      .recent-files {
        height: 100%;
        background-color: var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .recent-files__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
      }
      .recent-files__content {
        padding: 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
      }

      .code-editor {
        height: 100%;
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
        overflow: hidden;
      }

      .schema-editor {
        height: 100%;
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
        overflow: hidden;
      }
    </style>
  </template>
}

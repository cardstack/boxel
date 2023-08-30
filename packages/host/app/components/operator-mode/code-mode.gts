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
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
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

  // FIXME better name to encompass inheritance vs file browser?
  @tracked fileView = 'inheritance';

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

  @action setFileView(view: string) {
    this.fileView = view;
  }

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>

    <div class='code-mode' data-test-code-mode>
      <div class='columns'>
        <div class='column'>
          {{! Move each container and styles to separate component }}
          <div
            class='inner-container file-view
              {{if (eq this.fileView "browser") "file-browser"}}'
          >
            <header>
              <button
                class='{{if (eq this.fileView "inheritance") "active"}}'
                {{on 'click' (fn this.setFileView 'inheritance')}}
                data-test-inheritance-toggle
              >
                Inheritance</button>
              <button
                class='{{if (eq this.fileView "browser") "active"}}'
                {{on 'click' (fn this.setFileView 'browser')}}
                data-test-file-browser-toggle
              >
                File Browser</button>
            </header>
            <section class='inner-container__content'>
              {{#if (eq this.fileView 'inheritance')}}
                <span data-test-inheritance-placeholder>Inheritance forthcoming</span>
              {{else}}
                <FileTree
                  @url={{ownRealmURL}}
                  @openFiles={{@controller.codeParams}}
                />
              {{/if}}
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

      .file-view header {
        margin: var(--boxel-sp-sm);
        display: flex;
        gap: var(--boxel-sp-sm);
      }

      /* FIXME why is the border chamfered-esque? */
      .file-view header button {
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-lg);
        font-weight: 700;
        background: transparent;
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius-sm);
        border-color: var(--boxel-400);
        border-width: 1px;
        flex: 1;
      }

      .file-view header button.active {
        background: var(--boxel-dark);
        color: var(--boxel-highlight);
        border-color: var(--boxel-dark);
      }

      .file-view.file-browser .inner-container__content {
        background: var(--boxel-light);
      }
    </style>
  </template>
}

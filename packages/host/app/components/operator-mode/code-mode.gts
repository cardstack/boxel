import Component from '@glimmer/component';
import { service } from '@ember/service';
import MonacoService from '@cardstack/host/services/monaco-service';
import { trackedFunction } from 'ember-resources/util/function';
import CardService from '@cardstack/host/services/card-service';
import { htmlSafe } from '@ember/template';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: Card;
  };
}

export default class OperatorModeCodeMode extends Component<Signature> {
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
    <div
      class='operator-mode-code-mode-background'
      style={{this.backgroundURLStyle}}
    ></div>

    <div class='operator-mode-code-mode' data-test-operator-mode-code-mode>
      <div class='columns'>
        <div class='column'>File tree</div>
        <div class='column'>Code</div>
        <div class='column'>Schema editor</div>
      </div>
    </div>

    <style>
      .operator-mode-code-mode {
        position: fixed;
        height: 100%;
        left: 0;
        right: 0;
        z-index: 1;
      }

      .operator-mode-code-mode-background {
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
        height: calc(100% - var(--search-sheet-closed-height) - 90px);
        margin-top: 70px;
        padding: var(--boxel-sp);
      }

      .column {
        flex: 1;
        border: 1px solid black;
        margin-right: var(--boxel-sp-lg);

        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}

import Component from '@glimmer/component';
import { service } from '@ember/service';
import { trackedFunction } from 'ember-resources/util/function';
import CardService from '@cardstack/host/services/card-service';
import { htmlSafe } from '@ember/template';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import CardPreviewPanel from '@cardstack/host/components/operator-mode/card-preview-panel';

interface Signature {
  Args: {
    card: CardDef;
  };
}

export default class CodeMode extends Component<Signature> {
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;

  fetchRealmInfo = trackedFunction(this, async () => {
    let realmInfo = await this.cardService.getRealmInfo(this.args.card);
    return realmInfo;
  });

  get realmBackgroundURL() {
    return this.fetchRealmInfo.value?.backgroundURL;
  }

  get realmIconURL() {
    return this.fetchRealmInfo.value?.iconURL;
  }

  get realmBackgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.realmBackgroundURL});`);
  }

  <template>
    <div
      class='code-mode-background'
      style={{this.realmBackgroundURLStyle}}
    ></div>

    <div class='code-mode' data-test-code-mode>
      <div class='columns'>
        <div class='column column--with-border'>File tree</div>
        <div class='column column--with-border'>Code</div>
        <div class='column' data-test-column-card-preview>
          <CardPreviewPanel
            @card={{@card}}
            @realmIconURL={{this.realmIconURL}}
          />
        </div>
      </div>
    </div>

    <style>
      .code-mode {
        height: 100%;
        left: 0;
        right: 0;
        z-index: 1;
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
        height: calc(100vh - var(--search-sheet-closed-height) - 90px);
        margin-top: 70px;
        padding: var(--boxel-sp);
      }

      .column {
        flex: 1;
        margin-right: var(--boxel-sp-lg);
        border-radius: var(--boxel-border-radius);
      }

      .column--with-border {
        border: 1px solid black;
      }
    </style>
  </template>
}

import { on } from '@ember/modifier';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { cssVar } from '@cardstack/boxel-ui/helpers';
import { Lock } from '@cardstack/boxel-ui/icons';

import { StackItem } from '@cardstack/host/lib/stack-item';
import CardService from '@cardstack/host/services/card-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmURL: string;
  };
}

export default class Workspace extends Component<Signature> {
  <template>
    <button
      class='workspace'
      data-test-workspace={{this.name}}
      {{on 'click' (perform this.openWorkspace)}}
    >
      <div
        class='icon'
        style={{cssVar workspace-background-image-url=this.backgroundImageURL}}
      >
        <img src={{this.iconURL}} alt='Workspace Icon' />
        <div class='small-icon'>
          <Lock width='11px' height='11px' />
        </div>
      </div>
      <div class='info'>
        <span class='name' data-test-workspace-name>{{this.name}}</span>
        <span class='type'>Personal</span>
      </div>
    </button>
    <style scoped>
      .workspace {
        min-width: 251.6px;
        width: 251.6px;
        height: 215.3px;
        display: flex;
        flex-direction: column;
        border-radius: 15px;
        border: solid 1px rgba(255, 255, 255, 0.5);
        overflow: hidden;
        padding: 0;
      }
      .icon {
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: contain;

        position: relative;
        height: 142px;
        width: 100%;

        display: flex;
        justify-content: center;
        align-items: center;
      }
      .icon > img {
        width: 60px;
        height: 60px;
      }
      .small-icon {
        position: absolute;
        top: var(--boxel-sp-xxxs);
        left: var(--boxel-sp-xxxs);
        padding: var(--boxel-sp-6xs) var(--boxel-sp-5xs);
        background: var(--boxel-dark);
        border-radius: 5px;

        --icon-color: var(--boxel-light);
      }
      .info {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background-color: var(--boxel-dark);
        flex: 1;
        width: 100%;
        padding: var(--boxel-sp-xs);
      }
      .info > span {
        text-overflow: ellipsis;
        overflow: hidden;
        width: 100%;
        text-wrap: nowrap;
        text-align: center;
      }
      .name {
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);
      }
      .type {
        color: var(--boxel-400);
        font: 500 var(--boxel-font-xs);
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  @cached
  private get realmInfo() {
    return this.realm.info(this.args.realmURL);
  }

  private get name() {
    return this.realmInfo.name;
  }

  private get iconURL() {
    return this.realmInfo.iconURL;
  }

  private get backgroundURL() {
    return this.realmInfo.backgroundURL;
  }

  private get backgroundImageURL() {
    return this.backgroundURL ? `url(${this.backgroundURL})` : '';
  }

  private openWorkspace = restartableTask(async () => {
    debugger;
    let card = await this.cardService.getCard(this.args.realmURL);
    let stackItem = new StackItem({
      owner: this,
      card,
      format: 'isolated',
      stackIndex: 0,
    });
    await stackItem.ready();
    this.operatorModeStateService.clearStacks();
    this.operatorModeStateService.addItemToStack(stackItem);

    let cardController = getOwner(this)!.lookup('controller:card') as any;
    if (!cardController) {
      throw new Error(
        'Workspace component must be used in the context of a CardController',
      );
    }

    cardController.workspaceChooserOpened = false;
  });
}

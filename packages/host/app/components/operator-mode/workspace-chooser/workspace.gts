import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { cssVar, not } from '@cardstack/boxel-ui/helpers';
import { Lock } from '@cardstack/boxel-ui/icons';

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
      {{on 'click' this.openWorkspace}}
    >
      <div
        class='icon'
        style={{cssVar workspace-background-image-url=this.backgroundImageURL}}
      >
        <img src={{this.iconURL}} alt='Workspace Icon' />
        {{#if (not this.isPublic)}}
          <div class='small-icon'>
            <Lock width='11px' height='11px' />
          </div>
        {{/if}}
      </div>
      <div class='info'>
        <span class='name' data-test-workspace-name>{{this.name}}</span>
        <span class='type'>{{if this.isPublic 'Catalog' 'Personal'}}</span>
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
        background-size: cover;
        background-repeat: no-repeat;

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

  @cached
  private get isPublic() {
    return this.realm.isPublic(this.args.realmURL);
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

  @action openWorkspace() {
    this.operatorModeStateService.openWorkspace.perform(this.args.realmURL);
  }
}

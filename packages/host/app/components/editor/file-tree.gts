import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';

import Directory from './directory';

interface Signature {
  Args: {
    realmURL: URL;
  };
}

export default class FileTree extends Component<Signature> {
  <template>
    <div class='realm-info'>
      <RealmInfoProvider @realmURL={{@realmURL}}>
        <:ready as |realmInfo|>
          <RealmIcon
            @realmIconURL={{realmInfo.iconURL}}
            @realmName={{realmInfo.name}}
            class='icon'
          />
          <span data-test-realm-name={{realmInfo.name}}>In
            {{realmInfo.name}}</span>
        </:ready>
      </RealmInfoProvider>
    </div>
    <nav>
      <Directory @relativePath='' @realmURL={{@realmURL}} />
      {{#if this.showMask}}
        <div class='mask' data-test-file-tree-mask></div>
      {{/if}}
    </nav>

    <style>
      .mask {
        position: absolute;
        top: 0;
        left: 0;
        background-color: white;
        height: 100%;
        width: 100%;
      }
      nav {
        position: relative;
      }
      .realm-info {
        position: sticky;
        top: calc(var(--boxel-sp-xxs) * -1);
        left: calc(var(--boxel-sp-xs) * -1);
        margin: calc(var(--boxel-sp-xxs) * -1) calc(var(--boxel-sp-xs) * -1) 0
          calc(var(--boxel-sp-xs) * -1);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        box-shadow: var(--boxel-box-shadow);
        z-index: 1;

        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        font: 700 var(--boxel-font-sm);
      }

      .realm-info img {
        width: 18px;
      }
    </style>
  </template>

  @service private declare router: RouterService;
  @tracked private showMask = true;
  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.hideMask.perform();
  }

  private hideMask = restartableTask(async () => {
    // fine tuned to coincide with debounce in RestoreScrollPosition modifier
    await timeout(300);
    this.showMask = false;
  });
}

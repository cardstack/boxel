import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';
import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';

import Directory from './directory';

interface Args {
  Args: {
    realmURL: URL;
  };
}

export default class FileTree extends Component<Args> {
  <template>
    <div class='file-realm-info'>
      <RealmInfoProvider @realmURL={{@realmURL}}>
        <:ready as |realmInfo|>
          <RealmIcon
            @realmIconURL={{realmInfo.iconURL}}
            @realmName={{realmInfo.name}}
            class='icon'
          />
          <span>{{realmInfo.name}}</span>
        </:ready>
      </RealmInfoProvider>
    </div>
    <nav>
      <Directory @relativePath='' @realmURL={{@realmURL}} />
    </nav>

    <style>
      .file-realm-info {
        position: sticky;
        top: calc(var(--boxel-sp-xxs) * -1);
        left: calc(var(--boxel-sp-xs) * -1);
        margin: calc(var(--boxel-sp-xxs) * -1) calc(var(--boxel-sp-xs) * -1) 0
          calc(var(--boxel-sp-xs) * -1);
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        box-shadow: var(--boxel-box-shadow);
        z-index: 1;

        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .file-realm-info img {
        width: 16px;
      }
    </style>
  </template>

  @service declare router: RouterService;
}

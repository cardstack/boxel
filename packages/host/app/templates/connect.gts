import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface ConnectComponentSignature {
  Args: {};
}

let sendReadyMessage = modifier((_element: HTMLElement) => {
  window.top?.postMessage('ready', '*');
});

class ConnectComponent extends Component<ConnectComponentSignature> {
  @service private declare matrixService: MatrixService;

  @tracked storageAccess: boolean | undefined = undefined;

  constructor(owner: unknown, args: ConnectComponentSignature['Args']) {
    super(owner, args);
    this.storeAccessPermissions();
  }

  @action
  async storeAccessPermissions() {
    this.storageAccess = await window.document.hasStorageAccess();
    console.log('storage access response', this.storageAccess);
  }

  @action
  async connect() {
    // FIXME Chrome only
    let handle = await window.document.requestStorageAccess({
      localStorage: true,
    });

    console.log('handle?', handle);

    console.log(handle.localStorage['auth']);

    // FIXME should Matrix service instead use the requested handle?
    window.localStorage.setItem('auth', handle.localStorage['auth']);

    await this.matrixService.start();
  }

  <template>
    {{#if this.storageAccess}}
      {{#if this.matrixService.isLoggedIn}}
        Logged in as
        <div data-test-session>{{this.matrixService.userId}}</div>
      {{else}}
        <BoxelButton
          class='connect'
          data-test-connect
          {{sendReadyMessage}}
          {{on 'click' this.connect}}
        >
          <BoxelIcon
            name='connect'
            width='16'
            height='16'
            class='connect-icon'
          />
          Connect
        </BoxelButton>
      {{/if}}
    {{else}}
      {{! FIXME duplicate button }}
      <BoxelButton
        class='connect'
        data-test-connect
        {{sendReadyMessage}}
        {{on 'click' this.connect}}
      >
        <BoxelIcon name='connect' width='16' height='16' class='connect-icon' />
        Connect
      </BoxelButton>
    {{/if}}

    <style scoped>
      :global(body) {
        background: transparent;
      }

      .connect {
        position: absolute;
        right: 0;

        background-color: var(--boxel-700);
        border-radius: var(--boxel-border-radius-sm);
        color: var(--boxel-light);
        display: flex;
        gap: var(--boxel-sp-xxs);
        font-weight: 400;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
    </style>
  </template>
}

export default RouteTemplate(ConnectComponent);

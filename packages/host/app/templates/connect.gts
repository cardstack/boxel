import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { Avatar, BoxelButton } from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface ConnectComponentSignature {
  Args: {
    model: string;
  };
}

let sendReadyMessage = modifier((_element: HTMLElement) => {
  window.top?.postMessage('ready', '*');
});

class ConnectComponent extends Component<ConnectComponentSignature> {
  @service declare private matrixService: MatrixService;

  @tracked storageAccess: boolean | undefined = undefined;

  constructor(owner: Owner, args: ConnectComponentSignature['Args']) {
    super(owner, args);
    this.storeAccessPermissions();
  }

  get parentIframeOrigin() {
    return this.args.model;
  }

  @action
  async storeAccessPermissions() {
    this.storageAccess = await window.document.hasStorageAccess();
  }

  @action
  async connect() {
    let handle = await this.matrixService.requestStorageAccess();

    if (handle) {
      if (handle?.localStorage?.getItem('auth')) {
        window.localStorage.setItem('auth', handle.localStorage['auth']);
      } else {
        window.top?.postMessage('login', this.parentIframeOrigin);
      }
    }

    await this.matrixService.start();
  }

  <template>
    {{#if this.storageAccess}}
      {{#if this.matrixService.isLoggedIn}}
        <section class='session-container'>
          <BoxelIcon
            name='connect'
            width='18'
            height='18'
            class='connect-icon'
          />
          <Avatar
            @isReady={{this.matrixService.profile.loaded}}
            @userId={{this.matrixService.userId}}
            @displayName={{this.matrixService.profile.displayName}}
          />
        </section>
      {{else}}
        <ConnectButton {{on 'click' this.connect}} {{sendReadyMessage}} />
      {{/if}}
    {{else}}
      <ConnectButton {{on 'click' this.connect}} {{sendReadyMessage}} />
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

      .session-container {
        --profile-avatar-icon-size: 28.5px;
        --profile-avatar-icon-border: 1px;

        position: absolute;
        right: 0;

        display: flex;
        justify-content: flex-end;
        align-items: center;

        background: var(--boxel-700);

        border: var(--boxel-border-flexible);
        border-top-left-radius: var(--boxel-border-radius-sm);
        border-bottom-left-radius: var(--boxel-border-radius-sm);
        border-top-right-radius: 30px;
        border-bottom-right-radius: 30px;

        padding: var(--boxel-sp-xxs);
        padding-left: var(--boxel-sp-sm);

        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>
}

interface ConnectButtonSignature {
  Element: HTMLButtonElement;
  Args: {};
}

const ConnectButton: TemplateOnlyComponent<ConnectButtonSignature> = <template>
  <BoxelButton class='connect' data-test-connect ...attributes>
    <BoxelIcon name='connect' width='16' height='16' class='connect-icon' />
    Connect
  </BoxelButton>

  <style scoped>
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
</template>;

export default RouteTemplate(ConnectComponent);

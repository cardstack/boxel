import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';
import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

interface ConnectComponentSignature {
  Args: {};
}

let sendReadyMessage = modifier((_element: HTMLElement) => {
  window.top?.postMessage('ready', '*');
});

class ConnectComponent extends Component<ConnectComponentSignature> {
  <template>
    <BoxelButton class='connect' data-test-connect {{sendReadyMessage}}>
      <BoxelIcon name='connect' width='16' height='16' class='connect-icon' />
      Connect
    </BoxelButton>

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

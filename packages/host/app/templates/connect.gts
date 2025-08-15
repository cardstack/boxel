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
    <BoxelButton data-test-connect {{sendReadyMessage}}>
      <BoxelIcon name='connect' width='16' height='16' class='connect-icon' />
      Connect
    </BoxelButton>
  </template>
}

export default RouteTemplate(ConnectComponent);

import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

interface ConnectComponentSignature {
  Args: {};
}

class ConnectComponent extends Component<ConnectComponentSignature> {
  <template>
    <BoxelButton data-test-connect>
      <BoxelIcon name='connect' width='16' height='16' class='connect-icon' />
      Connect
    </BoxelButton>
  </template>
}

export default RouteTemplate(ConnectComponent);

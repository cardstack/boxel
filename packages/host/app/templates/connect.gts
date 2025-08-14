import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

interface ConnectComponentSignature {
  Args: {};
}

class ConnectComponent extends Component<ConnectComponentSignature> {
  <template>
    <button data-test-connect>Connect</button>
  </template>
}

export default RouteTemplate(ConnectComponent);

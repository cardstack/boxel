import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface ConnectComponentSignature {
  Args: {};
}

class ConnectComponent extends Component<ConnectComponentSignature> {
  @service private declare matrixService: MatrixService;

  <template>
    {{#if this.matrixService.isLoggedIn}}
      Logged in as
      {{this.matrixService.userId}}
    {{else}}
      Not logged in: Connect
    {{/if}}
  </template>
}

export default RouteTemplate(ConnectComponent);

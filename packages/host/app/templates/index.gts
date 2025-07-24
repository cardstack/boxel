import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { pageTitle } from 'ember-page-title';

import RouteTemplate from 'ember-route-template';

import OperatorModeContainer from '../components/operator-mode/container';

import type OperatorModeStateService from '../services/operator-mode-state-service';

class IndexComponent extends Component<void> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  // Remove this and onClose argument in OperatorModeContainer once we remove host mode and the card route, where closing operator mode will not be a thing anymore
  @action closeOperatorMode() {
    // noop
  }

  <template>
    {{pageTitle this.operatorModeStateService.title}}
    <OperatorModeContainer @onClose={{this.closeOperatorMode}} />
  </template>
}

export default RouteTemplate(IndexComponent);

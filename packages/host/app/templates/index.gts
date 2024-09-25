import { action } from '@ember/object';
import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import OperatorModeContainer from '../components/operator-mode/container';

class IndexComponent extends Component<void> {
  // Remove this and onClose argument in OperatorModeContainer once we remove host mode and the card route, where closing operator mode will not be a thing anymore
  @action closeOperatorMode() {
    // noop
  }

  <template>
    <div>
      <OperatorModeContainer @onClose={{this.closeOperatorMode}} />
    </div>
  </template>
}

export default RouteTemplate(IndexComponent);

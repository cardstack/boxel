import Component from '@glimmer/component';

import { action } from '@ember/object';
import { service } from '@ember/service';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import SubmodeLayout from './submode-layout';

export default class HostSubmode extends Component {
  @service private declare operatorModeStateService: OperatorModeStateService;

  @action private noop() {}

  <template>
    <SubmodeLayout
      @onCardSelectFromSearch={{this.noop}}
      class='host-submode-layout'
      data-test-host-submode
    >
      <div class='host-submode'>
        Host submode:
        {{this.operatorModeStateService.state.codePath.href}}
      </div>
    </SubmodeLayout>

    <style scoped>
      .host-submode {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 100%;
      }
    </style>
  </template>
}

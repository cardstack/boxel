import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { Button } from '@cardstack/boxel-ui/components';

import type { PatchObject } from 'https://cardstack.com/base/room';

interface RoomArgs {
  Args: {
    payload: PatchObject;
  };
}

export default class RoomApplyPatch extends Component<RoomArgs> {
  @service private declare operatorModeStateService: OperatorModeStateService;

  private patchCard = (cardId: string, attributes: any) => {
    this.operatorModeStateService.patchCard.perform(cardId, attributes);
  };

  <template>
    <div
      data-test-patch-card-idle={{this.operatorModeStateService.patchCard.isIdle}}
    >
      <Button
        @kind='secondary-dark'
        data-test-command-apply
        {{on 'click' (fn this.patchCard @payload.id @payload.patch.attributes)}}
        @loading={{this.operatorModeStateService.patchCard.isRunning}}
        @disabled={{this.operatorModeStateService.patchCard.isRunning}}
      >
        Apply
      </Button>
    </div>
  </template>
}

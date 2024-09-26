import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import stringify from 'safe-stable-stringify';

import OperatorModeStateService, {
  SerializedState as OperatorModeSerializedState,
} from '@cardstack/host/services/operator-mode-state-service';

import { Submodes } from '../components/submode-switcher';
import CardService from '../services/card-service';
import MatrixService from '../services/matrix-service';

export default class Index extends Route<void> {
  queryParams = {
    operatorModeState: {
      refreshModel: true, // Enabled so that back-forward navigation works in operator mode
    },
    // operatorModeEnabled: {
    //   refreshModel: true,
    // },
    // `sid` and `clientSecret` come from email verification process to reset password
    sid: { refreshModel: true },
    clientSecret: { refreshModel: true },
  };

  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @service private declare router: RouterService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  didMatrixServiceStart = false;

  async beforeModel(transition: Transition): Promise<void> {
    debugger;
    if (!this.didMatrixServiceStart) {
      await this.matrixService.ready;
      await this.matrixService.start();
      this.didMatrixServiceStart = true;
    }
    let cardUrl = transition.to!.queryParams.card;
    let stacks = [];

    if (cardUrl) {
      stacks = [
        [
          {
            id: cardUrl,
            format: 'isolated',
          },
        ],
      ];
    }
    if (!transition.to!.queryParams.operatorModeState) {
      this.router.transitionTo('index', {
        queryParams: {
          card: undefined,
          workspaceChooserOpened: stacks.length === 0,
          operatorModeState: stringify({
            stacks,
            submode: Submodes.Interact,
          } as OperatorModeSerializedState),
        },
      });
    } else {
      let operatorModeStateObject = JSON.parse(
        transition.to!.queryParams.operatorModeState as string,
      );
      await this.operatorModeStateService.restore(
        operatorModeStateObject || { stacks: [] },
      );
    }
  }
}

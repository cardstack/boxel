import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';

import { service } from '@ember/service';

import stringify from 'safe-stable-stringify';

import { type SerializedState as OperatorModeSerializedState } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { Submodes } from '../components/submode-switcher';
import { getCard } from '../resources/card-resource';
import CardService from '../services/card-service';
import MatrixService from '../services/matrix-service';

export default class Index extends Route<void> {
  queryParams = {
    operatorModeState: {
      refreshModel: true, // Enabled so that back-forward navigation works in operator mode
    },

    // `sid` and `clientSecret` come from email verification process to reset password
    sid: { refreshModel: true },
    clientSecret: { refreshModel: true },
  };

  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @service private declare router: RouterService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  didMatrixServiceStart = false;

  async model(params: {
    card?: string;
    path: string;
    operatorModeState: string;
    operatorModeEnabled: boolean;
  }): Promise<void> {
    let { operatorModeState, card } = params;

    if (!this.didMatrixServiceStart) {
      await this.matrixService.ready;
      await this.matrixService.start();
      this.didMatrixServiceStart = true;
    }

    if (!this.matrixService.isLoggedIn) {
      this.didMatrixServiceStart = false;
      return;
    }

    let cardUrl;

    if (card) {
      let resource = getCard(this, () => card);
      await resource.loaded;
      cardUrl = resource?.card?.id; // This is to make sure we put the canonical URL of the card on the stack
      // TODO: what to do if card is not found, or not accessible?
      if (!cardUrl) {
        alert('Card not found');
      }
    }

    let stacks: { id: string; format: string }[][] = [];

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
    if (!operatorModeState) {
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
      return;
    } else {
      let operatorModeStateObject = JSON.parse(operatorModeState);

      if (this.operatorModeStateService.serialize() === operatorModeState) {
        // If the operator mode state in the query param is the same as the one we have in memory,
        // we don't want to restore it again, because it will lead to rerendering of the stack items, which can
        // bring various annoyances, e.g reloading of the items in the index card.
        // We will reach this point when the user manipulates the stack and the operator state service will set the
        // query param, which will trigger a refresh of the model, which will call the model hook again.
        // The model refresh happens automatically because we have operatorModeState: { refreshModel: true } in the queryParams.
        // We have that because we want to support back-forward navigation in operator mode.
        return;
      }
      await this.operatorModeStateService.restore(
        operatorModeStateObject || { stacks: [] },
      );
    }
  }
}

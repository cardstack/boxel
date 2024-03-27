import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { all, task, timeout } from 'ember-concurrency';
import stringify from 'safe-stable-stringify';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import { getCard } from '@cardstack/host/resources/card-resource';
import MatrixService from '@cardstack/host/services/matrix-service';
import OperatorModeStateService, {
  SerializedState as OperatorModeSerializedState,
} from '@cardstack/host/services/operator-mode-state-service';
import RealmInfoService from '@cardstack/host/services/realm-info-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';

const { ownRealmURL, loginMessageTimeoutMs } = ENV;

export type Model = CardDef | null;

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

export default class RenderCard extends Route<Model | null> {
  queryParams = {
    operatorModeState: {
      refreshModel: true, // Enabled so that back-forward navigation works in operator mode
    },
    operatorModeEnabled: {
      refreshModel: true,
    },
    // `sid` and `clientSecret` come from email verification process to reset password
    sid: { refreshModel: true },
    clientSecret: { refreshModel: true },
  };

  @service declare cardService: CardService;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare matrixService: MatrixService;
  @service declare realmInfoService: RealmInfoService;
  hasLoadMatrixBeenExecuted = false;

  async model(params: {
    path: string;
    operatorModeState: string;
    operatorModeEnabled: boolean;
  }): Promise<Model> {
    let { path, operatorModeState, operatorModeEnabled } = params;
    path = path || '';
    let url = path
      ? new URL(`/${path}`, ownRealmURL)
      : new URL('./', ownRealmURL);

    try {
      await this.loadMatrix.perform();
      let isPublicReadableRealm = await this.realmInfoService.isPublicReadable(
        new URL(ownRealmURL),
      );
      let model = null;
      if (!isPublicReadableRealm && !this.matrixService.isLoggedIn) {
        return model;
      }
      let cardResource = getCard(this, () => url.href);
      await cardResource.loaded;
      model = cardResource.card;
      if (!model) {
        throw new Error(`Could not find ${url}`);
      }

      if (operatorModeEnabled) {
        let operatorModeStateObject = JSON.parse(operatorModeState);

        if (this.operatorModeStateService.serialize() === operatorModeState) {
          // If the operator mode state in the query param is the same as the one we have in memory,
          // we don't want to restore it again, because it will lead to rerendering of the stack items, which can
          // bring various annoyances, e.g reloading of the items in the index card.
          // We will reach this point when the user manipulates the stack and the operator state service will set the
          // query param, which will trigger a refresh of the model, which will call the model hook again.
          // The model refresh happens automatically because we have operatorModeState: { refreshModel: true } in the queryParams.
          // We have that because we want to support back-forward navigation in operator mode.
          return model ?? null;
        }
        await this.operatorModeStateService.restore(operatorModeStateObject);
      }

      return model ?? null;
    } catch (e) {
      (e as any).loadType = params.operatorModeEnabled
        ? 'stack'
        : url.href === ownRealmURL
        ? 'index'
        : 'card';
      (e as any).operatorModeState = params.operatorModeState;
      throw e;
    }
  }

  async redirect(_model: Model, transition: Transition) {
    // Users are not allowed to access guest mode if realm is not publicly readable,
    // so users will be redirected to operator mode.
    // We can update the codes below after we have a clear idea on how to implement authentication in guest mode.
    let isPublicReadableRealm = await this.realmInfoService.isPublicReadable(
      new URL(ownRealmURL),
    );
    if (
      !isPublicReadableRealm &&
      !transition.to?.queryParams['operatorModeEnabled']
    ) {
      let path = transition.to?.params?.path ?? '';
      let url = path
        ? new URL(`/${path}`, ownRealmURL)
        : new URL('./', ownRealmURL);
      await this.router.replaceWith(`card`, {
        queryParams: {
          operatorModeEnabled: 'true',
          operatorModeState: stringify({
            stacks: [
              [
                {
                  id: url.href,
                  format: 'isolated',
                },
              ],
            ],
            submode: Submodes.Interact,
          } as OperatorModeSerializedState),
        },
      });
    }
  }

  loadMatrix = task(async () => {
    if (this.hasLoadMatrixBeenExecuted) {
      return;
    }

    await all([
      await (async () => {
        await this.matrixService.ready;
        await this.matrixService.start();
      })(),
      timeout(loginMessageTimeoutMs),
    ]);
    this.hasLoadMatrixBeenExecuted = true;
  });
}

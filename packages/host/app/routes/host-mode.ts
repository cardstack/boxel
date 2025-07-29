import Route from '@ember/routing/route';
import { inject as service } from '@ember/service';

import { RealmPaths } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

export default class HostMode extends Route<void> {
  @service declare store: StoreService;
  @service declare realmServer: RealmServerService;

  didMatrixServiceStart = false;

  async beforeModel() {
    return this.realmServer.availableRealmsAreReady;
  }

  async model(params: { realm: string; path: string }): Promise<void> {
    let { realm, path } = params;

    // FIXME this is a hack and won’t work in many circumstances
    let matchingRealm = this.realmServer.availableRealmsFIXME.find(
      (availableRealm) => availableRealm.url.endsWith(`/${realm}/`),
    );

    if (!matchingRealm) {
      throw new Error(`Realm not found: ${realm}`);
    }

    let cardURL = new RealmPaths(new URL(matchingRealm?.url)).fileURL(path);

    let gotten = await this.store.get(cardURL.href);

    return gotten;

    /*
    let cardUrl: string | undefined = cardPath
      ? await this.getCardUrl(cardPath)
      : undefined;
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
    let operatorModeStateObject = operatorModeState
      ? JSON.parse(operatorModeState)
      : undefined;
    if (
      !operatorModeStateObject ||
      (operatorModeStateObject.submode === Submodes.Interact &&
        operatorModeStateObject.stacks.length === 0 &&
        operatorModeStateObject.workspaceChooserOpened !== true)
    ) {
      this.router.transitionTo('index', {
        queryParams: {
          cardPath: undefined,
          operatorModeState: stringify({
            stacks,
            submode: Submodes.Interact,
            aiAssistantOpen: this.operatorModeStateService.aiAssistantOpen,
            workspaceChooserOpened: stacks.length === 0,
          } as OperatorModeSerializedState),
        },
      });
      return;
    } else {
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
      */
  }
}

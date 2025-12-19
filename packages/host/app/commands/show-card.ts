import { service } from '@ember/service';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import { identifyCard, internalKeyFor } from '@cardstack/runtime-common';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type PlaygroundPanelService from '../services/playground-panel-service';
import type StoreService from '../services/store';

export default class ShowCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.ShowCardInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private playgroundPanelService: PlaygroundPanelService;
  @service declare private store: StoreService;

  description =
    'Show a card in the UI. The cardId must be a fully qualified URL.';

  static actionVerb = 'Show Card';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ShowCardInput } = commandModule;
    return ShowCardInput;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseCommandModule.ShowCardInput,
  ): Promise<undefined> {
    let { operatorModeStateService, store } = this;
    if (operatorModeStateService.workspaceChooserOpened) {
      operatorModeStateService.closeWorkspaceChooser();
    }
    if (operatorModeStateService.state?.submode === 'interact') {
      let newStackIndex = Math.min(
        operatorModeStateService.numberOfStacks(),
        1,
      );
      let newStackItem = await operatorModeStateService.createStackItem(
        input.cardId,
        newStackIndex,
        (input.format as 'isolated' | 'edit') || 'isolated',
      );
      operatorModeStateService.addItemToStack(newStackItem);
    } else if (operatorModeStateService.state?.submode === 'code') {
      let cardInstance = await store.get<CardDef>(input.cardId);
      let cardDefRef = identifyCard(
        cardInstance.constructor as typeof CardDef,
      ) as ResolvedCodeRef;
      if (!cardDefRef) {
        throw new Error(`Card definition for ${input.cardId} not found.`);
      }
      if (
        !operatorModeStateService.codePathString?.startsWith(
          cardDefRef.module,
        ) ||
        operatorModeStateService.state.codeSelection !== cardDefRef.name
      ) {
        await operatorModeStateService.updateCodePath(
          new URL(cardDefRef.module + '.gts'),
          'preview',
        );
      }
      this.playgroundPanelService.persistSelections(
        internalKeyFor(cardDefRef, undefined),
        input.cardId,
        (input.format as Format) || 'isolated',
        undefined,
      );
    } else {
      console.error(
        'Unknown submode:',
        this.operatorModeStateService.state?.submode,
      );
    }
  }
}

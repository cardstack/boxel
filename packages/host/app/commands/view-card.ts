import { service } from '@ember/service';

import type { Format } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Submodes } from '../components/submode-switcher';
import HostBaseCommand from '../lib/host-base-command';

import UpdatePlaygroundSelectionCommand from './update-playground-selection';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type StoreService from '../services/store';

export default class ViewCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.ViewCardInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private store: StoreService;

  description =
    'View a card in the appropriate submode. Handles submode-specific navigation.';
  static actionVerb = 'View Card';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ViewCardInput } = commandModule;
    return ViewCardInput;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseCommandModule.ViewCardInput,
  ): Promise<undefined> {
    const currentSubmode = this.operatorModeStateService.state?.submode;

    // Check submode first and handle appropriately
    switch (currentSubmode) {
      case Submodes.Interact:
        await this.handleInteractMode(input);
        break;
      case Submodes.Code:
        await this.handleCodeMode(input);
        break;
      default:
        throw new Error(`Unsupported submode: ${currentSubmode}`);
    }
  }

  private async handleInteractMode(input: BaseCommandModule.ViewCardInput) {
    if (this.operatorModeStateService.workspaceChooserOpened) {
      this.operatorModeStateService.closeWorkspaceChooser();
    }

    const format = (input.format as 'isolated' | 'edit') || 'isolated';

    // Stack context is required - no fallback behavior
    if (this.commandContext.stackInfo === undefined) {
      throw new Error('No stackInfo exists inside context');
    }

    let stackIndex = this.commandContext.stackInfo.index;

    const newStackItem = await this.operatorModeStateService.createStackItem(
      input.cardId,
      stackIndex,
      format,
    );

    this.operatorModeStateService.addItemToStack(newStackItem);
  }

  private async handleCodeMode(input: BaseCommandModule.ViewCardInput) {
    await this.operatorModeStateService.updateCodePath(new URL(input.cardId));

    await new UpdatePlaygroundSelectionCommand(
      this.commandContext,
    ).execute({
      moduleId: undefined,
      cardId: input.cardId,
      format: (input.format as Format) || 'isolated',
      fieldIndex: undefined,
    });
  }
}

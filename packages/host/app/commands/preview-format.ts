import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import ShowCardCommand from './show-card';
import SwitchSubmodeCommand from './switch-submode';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class PreviewFormatCommand extends HostBaseCommand<
  typeof BaseCommandModule.PreviewFormatInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description =
    'Open code mode, navigate to a module, set preview panel to isolated view, and show a card in the specified format.';

  static actionVerb = 'Preview Format';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { PreviewFormatInput } = commandModule;
    return PreviewFormatInput;
  }

  protected async run(
    input: BaseCommandModule.PreviewFormatInput,
  ): Promise<undefined> {
    // 1. Switch to code submode
    await new SwitchSubmodeCommand(this.commandContext).execute({
      submode: 'code',
      codePath: input.modulePath,
    });

    // 2. Set module inspector to preview
    this.operatorModeStateService.persistModuleInspectorView(
      input.modulePath,
      'preview',
    );

    // 3. Show the card in the specified format using ShowCardCommand
    let showCardCommand = new ShowCardCommand(this.commandContext);
    await showCardCommand.execute({
      cardId: input.cardId,
      format: input.format,
    });
  }
}

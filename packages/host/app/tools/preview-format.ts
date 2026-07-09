import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import ShowCardTool from './show-card';
import SwitchSubmodeTool from './switch-submode';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class PreviewFormatTool extends HostBaseTool<
  typeof BaseToolModule.PreviewFormatInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description =
    'Open code mode, navigate to a module, set preview panel to isolated view, and show a card in the specified format.';

  static actionVerb = 'Preview Format';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { PreviewFormatInput } = commandModule;
    return PreviewFormatInput;
  }

  requireInputFields = ['cardId', 'format', 'modulePath'];

  protected async run(
    input: BaseToolModule.PreviewFormatInput,
  ): Promise<undefined> {
    // 1. Switch to code submode
    await new SwitchSubmodeTool(this.commandContext).execute({
      submode: 'code',
      codePath: input.modulePath,
    });

    // 2. Set module inspector to preview
    this.operatorModeStateService.persistModuleInspectorView(
      input.modulePath,
      'preview',
    );

    // 3. Show the card in the specified format using ShowCardTool
    let showCardCommand = new ShowCardTool(this.commandContext);
    await showCardCommand.execute({
      cardId: input.cardId,
      format: input.format,
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { PreviewFormatTool as PreviewFormatCommand };

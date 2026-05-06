import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class ShowFileCommand extends HostBaseCommand<
  typeof BaseCommandModule.FileIdentifierCard
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description =
    'Show a file in the code submode. The fileIdentifier must be a fully qualified URL.';

  static actionVerb = 'Show File';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { FileIdentifierCard } = commandModule;
    return FileIdentifierCard;
  }

  requireInputFields = ['fileIdentifier'];

  protected async run(
    input: BaseCommandModule.FileIdentifierCard,
  ): Promise<undefined> {
    let { operatorModeStateService } = this;
    if (operatorModeStateService.workspaceChooserOpened) {
      operatorModeStateService.closeWorkspaceChooser();
    }
    await operatorModeStateService.updateCodePath(
      new URL(input.fileIdentifier),
    );
    await operatorModeStateService.updateSubmode('code');
  }
}

import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class ShowFileTool extends HostBaseTool<
  typeof BaseToolModule.FileIdentifierCard
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description =
    'Show a file in the code submode. The fileIdentifier must be a fully qualified URL.';

  static actionVerb = 'Show File';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { FileIdentifierCard } = commandModule;
    return FileIdentifierCard;
  }

  requireInputFields = ['fileIdentifier'];

  protected async run(
    input: BaseToolModule.FileIdentifierCard,
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

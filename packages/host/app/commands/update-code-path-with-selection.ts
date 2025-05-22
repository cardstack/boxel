import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RecentFilesService from '../services/recent-files-service';

export default class UpdateCodePathWithSelectionCommand extends HostBaseCommand<
  typeof BaseCommandModule.UpdateCodePathWithSelectionInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private recentFilesService: RecentFilesService;
  description =
    'Update the selected code path when the user navigates to code mode.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { UpdateCodePathWithSelectionInput } = commandModule;
    return UpdateCodePathWithSelectionInput;
  }

  private get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  protected async run(
    input: BaseCommandModule.UpdateCodePathWithSelectionInput,
  ): Promise<undefined> {
    this.operatorModeStateService.updateCodePathWithSelection({
      codeRef: input.codeRef,
      localName: input.localName,
      fieldName: input.fieldName,
    });
    if (this.codePath) {
      let urlString = this.codePath.toString();
      this.recentFilesService.updateCursorPositionByURL(
        urlString.endsWith('gts') ? urlString : `${urlString}.gts`,
        undefined,
      );
    }
  }
}

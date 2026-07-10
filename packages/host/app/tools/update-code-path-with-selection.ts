import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RecentFilesService from '../services/recent-files-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class UpdateCodePathWithSelectionTool extends HostBaseTool<
  typeof BaseToolModule.UpdateCodePathWithSelectionInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private recentFilesService: RecentFilesService;
  description =
    'Update the selected code path when the user navigates to code mode.';
  static actionVerb = 'Open';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { UpdateCodePathWithSelectionInput } = commandModule;
    return UpdateCodePathWithSelectionInput;
  }

  private get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  protected async run(
    input: BaseToolModule.UpdateCodePathWithSelectionInput,
  ): Promise<undefined> {
    await this.operatorModeStateService.updateCodePathWithSelection({
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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { UpdateCodePathWithSelectionTool as UpdateCodePathWithSelectionCommand };

import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type PlaygroundPanelService from '../services/playground-panel-service';
import type { Format } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default class UpdatePlaygroundSelectionTool extends HostBaseTool<
  typeof BaseToolModule.UpdatePlaygroundSelectionInput
> {
  @service declare private playgroundPanelService: PlaygroundPanelService;
  description = 'Persist the playground selections.';
  static actionVerb = 'Save';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { UpdatePlaygroundSelectionInput } = commandModule;
    return UpdatePlaygroundSelectionInput;
  }

  requireInputFields = ['moduleId', 'cardId', 'format'];

  protected async run(
    input: BaseToolModule.UpdatePlaygroundSelectionInput,
  ): Promise<undefined> {
    this.playgroundPanelService.persistSelections(
      input.moduleId,
      rri(input.cardId),
      input.format as Format,
      input.fieldIndex,
    );
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { UpdatePlaygroundSelectionTool as UpdatePlaygroundSelectionCommand };

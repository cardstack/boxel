import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import type { Format } from 'https://cardstack.com/base/card-api';
import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type PlaygroundPanelService from '../services/playground-panel-service';

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

import { service } from '@ember/service';

import { Format } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type PlaygroundPanelService from '../services/playground-panel-service';

export default class UpdatePlaygroundSelectionCommand extends HostBaseCommand<
  typeof BaseCommandModule.UpdatePlaygroundSelectionInput
> {
  @service declare private playgroundPanelService: PlaygroundPanelService;
  description = 'Persist the playground selections.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { UpdatePlaygroundSelectionInput } = commandModule;
    return UpdatePlaygroundSelectionInput;
  }

  protected async run(
    input: BaseCommandModule.UpdatePlaygroundSelectionInput,
  ): Promise<undefined> {
    this.playgroundPanelService.persistSelections(
      input.moduleId,
      input.cardId,
      input.format as Format,
      input.fieldIndex,
    );
  }
}

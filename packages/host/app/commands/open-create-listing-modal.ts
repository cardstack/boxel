import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class OpenCreateListingModalCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingCreateInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description = 'Open create listing confirmation modal';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingCreateInput } = commandModule;
    return ListingCreateInput;
  }

  requireInputFields = ['codeRef', 'targetRealm'];

  protected async run(
    input: BaseCommandModule.ListingCreateInput,
  ): Promise<undefined> {
    this.operatorModeStateService.showCreateListingModal({
      codeRef: input.codeRef,
      targetRealm: input.targetRealm,
      openCardIds: input.openCardIds,
    });
  }
}

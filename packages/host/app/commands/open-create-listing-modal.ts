import { service } from '@ember/service';

import { isFieldDef } from '@cardstack/runtime-common';
import { loadCardDef } from '@cardstack/runtime-common/code-ref';

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
    let declarationKind: 'card' | 'field' = 'card';
    if (input.codeRef) {
      try {
        let cardOrField = await loadCardDef(input.codeRef, {
          loader: this.loaderService.loader,
        });
        declarationKind = isFieldDef(cardOrField) ? 'field' : 'card';
      } catch {
        declarationKind = 'card';
      }
    }

    this.operatorModeStateService.showCreateListingModal({
      codeRef: input.codeRef,
      targetRealm: input.targetRealm,
      openCardIds: input.openCardIds,
      declarationKind,
    });
  }
}

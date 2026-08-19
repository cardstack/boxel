import { service } from '@ember/service';

import {
  isFieldDef,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import { loadCardDef } from '@cardstack/runtime-common/code-ref';

import HostBaseTool from '../lib/host-base-tool';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class OpenCreateListingModalTool extends HostBaseTool<
  typeof BaseToolModule.ListingCreateInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description = 'Open create listing confirmation modal';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ListingCreateInput } = commandModule;
    return ListingCreateInput;
  }

  requireInputFields = ['codeRef', 'targetRealm'];

  protected async run(
    input: BaseToolModule.ListingCreateInput,
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
      openCardIds: input.openCardIds as RealmResourceIdentifier[] | undefined,
      supportingCardIds: input.supportingCardIds as
        | RealmResourceIdentifier[]
        | undefined,
      declarationKind,
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { OpenCreateListingModalTool as OpenCreateListingModalCommand };

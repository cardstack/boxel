import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import {
  canonicalRealmIdentifier,
  canonicalRealmIdentifiers,
} from '../lib/realm-utils';

import GetAvailableRealmIdentifiersTool from './get-available-realm-identifiers';

import type NetworkService from '../services/network';
import type * as BaseToolModule from '@cardstack/base/command';

export default class ValidateRealmTool extends HostBaseTool<
  typeof BaseToolModule.ValidateRealmInput,
  typeof BaseToolModule.ValidateRealmResult
> {
  @service declare private network: NetworkService;

  description =
    'Validate that a realm is available, given its URL or its realm-prefix identifier, and return it as the realm server lists it';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ValidateRealmInput } = commandModule;
    return ValidateRealmInput;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseToolModule.ValidateRealmInput,
  ): Promise<BaseToolModule.ValidateRealmResult> {
    let { realmIdentifiers } = await new GetAvailableRealmIdentifiersTool(
      this.toolContext,
    ).execute();

    // The input may name a realm by its prefix or by its URL, and the
    // available list holds whichever spelling each realm is registered under,
    // so both sides are folded to one identity before they are compared. The
    // result is the realm's spelling from the available list.
    let { virtualNetwork } = this.network;
    let wanted = canonicalRealmIdentifier(
      virtualNetwork,
      input.realmIdentifier,
    );
    let realmIdentifier = realmIdentifiers.find(
      (available) =>
        canonicalRealmIdentifier(virtualNetwork, available) === wanted,
    );
    if (!realmIdentifier) {
      throw new Error(
        `Invalid realm: ${input.realmIdentifier}. Valid realms: ${canonicalRealmIdentifiers(
          virtualNetwork,
          realmIdentifiers,
        ).join(', ')}`,
      );
    }

    let commandModule = await this.loadToolModule();
    const { ValidateRealmResult } = commandModule;
    return new ValidateRealmResult({ realmIdentifier });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ValidateRealmTool as ValidateRealmCommand };

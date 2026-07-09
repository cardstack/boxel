import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

export default class GetAvailableRealmIdentifiersTool extends HostBaseTool<
  undefined,
  typeof BaseToolModule.GetAvailableRealmIdentifiersResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Get Realm Identifiers';
  description = 'Get the list of available realm identifiers';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseToolModule.GetAvailableRealmIdentifiersResult> {
    let commandModule = await this.loadToolModule();
    const { GetAvailableRealmIdentifiersResult } = commandModule;
    return new GetAvailableRealmIdentifiersResult({
      realmIdentifiers: this.realmServer.availableRealmIdentifiers,
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GetAvailableRealmIdentifiersTool as GetAvailableRealmIdentifiersCommand };

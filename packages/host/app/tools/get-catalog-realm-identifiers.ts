import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';

export default class GetCatalogRealmIdentifiersTool extends HostBaseTool<
  undefined,
  typeof BaseToolModule.GetCatalogRealmIdentifiersResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Get Catalog Realm Identifiers';
  description = 'Get the list of catalog realm identifiers';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseToolModule.GetCatalogRealmIdentifiersResult> {
    let commandModule = await this.loadToolModule();
    const { GetCatalogRealmIdentifiersResult } = commandModule;
    return new GetCatalogRealmIdentifiersResult({
      realmIdentifiers: this.realmServer.catalogRealmIdentifiers,
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GetCatalogRealmIdentifiersTool as GetCatalogRealmIdentifiersCommand };

import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

export default class FullReindexRealmTool extends HostBaseTool<
  typeof BaseToolModule.RealmIdentifierCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Full Reindex';
  description =
    'Force a full realm reindex. This republishes a from-scratch indexing job after clearing indexed mtimes, so every file in the realm is revisited even if mtimes have not changed. Use this when the user suspects indexing drift, stale cached results, or wants a full rebuild instead of the lighter default reindex. A user may request that they want to perform a full or deep reload/refresh of a realm in order to fully reindex it.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { RealmIdentifierCard } = commandModule;
    return RealmIdentifierCard;
  }

  protected async run(
    input: BaseToolModule.RealmIdentifierCard,
  ): Promise<undefined> {
    await this.realm.fullReindex(input.realmIdentifier);
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { FullReindexRealmTool as FullReindexRealmCommand };

import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';

export default class FullReindexRealmTool extends HostBaseTool<
  typeof BaseCommandModule.RealmIdentifierCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Full Reindex';
  description =
    'Force a full realm reindex. This republishes a from-scratch indexing job after clearing indexed mtimes, so every file in the realm is revisited even if mtimes have not changed. Use this when the user suspects indexing drift, stale cached results, or wants a full rebuild instead of the lighter default reindex. A user may request that they want to perform a full or deep reload/refresh of a realm in order to fully reindex it.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RealmIdentifierCard } = commandModule;
    return RealmIdentifierCard;
  }

  protected async run(
    input: BaseCommandModule.RealmIdentifierCard,
  ): Promise<undefined> {
    await this.realm.fullReindex(input.realmIdentifier);
  }
}

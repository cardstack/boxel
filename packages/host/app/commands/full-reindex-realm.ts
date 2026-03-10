import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmService from '../services/realm';

export default class FullReindexRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.RealmUrlCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Full Reindex';
  description =
    'Force a full realm reindex. This republishes a from-scratch indexing job after clearing indexed mtimes, so every file in the realm is revisited even if mtimes have not changed. Use this when the user suspects indexing drift, stale cached results, or wants a full rebuild instead of the lighter default reindex.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RealmUrlCard } = commandModule;
    return RealmUrlCard;
  }

  protected async run(
    input: BaseCommandModule.RealmUrlCard,
  ): Promise<undefined> {
    await this.realm.fullReindex(input.realmUrl);
  }
}

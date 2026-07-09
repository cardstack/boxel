import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';

export default class ReindexRealmTool extends HostBaseTool<
  typeof BaseToolModule.RealmIdentifierCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Reindex';
  description =
    'Reindex a realm using the lighter/default mode. This republishes a from-scratch indexing job but only revisits files whose indexed state appears stale based on current mtime, deletion, or error semantics. Use this when a user wants to pick up normal recent changes or refresh a realm without performing a full reindex.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { RealmIdentifierCard } = commandModule;
    return RealmIdentifierCard;
  }

  protected async run(
    input: BaseToolModule.RealmIdentifierCard,
  ): Promise<undefined> {
    await this.realm.reindex(input.realmIdentifier);
  }
}

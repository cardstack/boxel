import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';

export default class CancelIndexingJobTool extends HostBaseTool<
  typeof BaseCommandModule.RealmIdentifierCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Cancel';
  description = 'Cancel any currently running indexing job for a realm';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RealmIdentifierCard } = commandModule;
    return RealmIdentifierCard;
  }

  protected async run(
    input: BaseCommandModule.RealmIdentifierCard,
  ): Promise<undefined> {
    await this.realm.cancelIndexingJob(input.realmIdentifier);
  }
}

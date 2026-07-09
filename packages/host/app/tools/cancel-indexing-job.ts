import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';

export default class CancelIndexingJobTool extends HostBaseTool<
  typeof BaseToolModule.RealmIdentifierCard,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Cancel';
  description = 'Cancel any currently running indexing job for a realm';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { RealmIdentifierCard } = commandModule;
    return RealmIdentifierCard;
  }

  protected async run(
    input: BaseToolModule.RealmIdentifierCard,
  ): Promise<undefined> {
    await this.realm.cancelIndexingJob(input.realmIdentifier);
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CancelIndexingJobTool as CancelIndexingJobCommand };

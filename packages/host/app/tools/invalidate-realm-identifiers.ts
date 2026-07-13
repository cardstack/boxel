import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

export default class InvalidateRealmIdentifiersTool extends HostBaseTool<
  typeof BaseToolModule.InvalidateRealmIdentifiersInput,
  undefined
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Invalidate';
  description =
    'Invalidate files in a realm to trigger re-indexing. A user may request that they want to reload or refresh a card in order to re-index it.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { InvalidateRealmIdentifiersInput } = commandModule;
    return InvalidateRealmIdentifiersInput;
  }

  protected async run(
    input: BaseToolModule.InvalidateRealmIdentifiersInput,
  ): Promise<undefined> {
    await this.realm.invalidateUrls(
      input.realmIdentifier,
      input.resourceIdentifiers,
    );
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { InvalidateRealmIdentifiersTool as InvalidateRealmIdentifiersCommand };

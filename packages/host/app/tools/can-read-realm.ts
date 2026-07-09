import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

export default class CanReadRealmTool extends HostBaseTool<
  typeof BaseToolModule.CanReadRealmInput,
  typeof BaseToolModule.CanReadRealmResult
> {
  @service declare private realm: RealmService;

  description = 'Check whether the current user can read a realm';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CanReadRealmInput } = commandModule;
    return CanReadRealmInput;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseToolModule.CanReadRealmInput,
  ): Promise<BaseToolModule.CanReadRealmResult> {
    let commandModule = await this.loadToolModule();
    const { CanReadRealmResult } = commandModule;
    return new CanReadRealmResult({
      canRead: this.realm.canRead(input.realmIdentifier),
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CanReadRealmTool as CanReadRealmCommand };

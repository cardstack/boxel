import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

export default class GetDefaultWritableRealmTool extends HostBaseTool<
  undefined,
  typeof BaseToolModule.GetDefaultWritableRealmResult
> {
  @service declare private realm: RealmService;

  description = 'Get the path of the default writable realm';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseToolModule.GetDefaultWritableRealmResult> {
    let commandModule = await this.loadToolModule();
    const { GetDefaultWritableRealmResult } = commandModule;
    return new GetDefaultWritableRealmResult({
      realmIdentifier: this.realm.defaultWritableRealm?.path ?? '',
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GetDefaultWritableRealmTool as GetDefaultWritableRealmCommand };

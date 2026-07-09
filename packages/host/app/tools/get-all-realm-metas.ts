import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type Realm from '../services/realm';

export default class GetAllRealmMetasTool extends HostBaseTool<
  undefined,
  typeof BaseToolModule.GetAllRealmMetasResult
> {
  @service declare private realm: Realm;

  static actionVerb = 'Fetch Realms';
  static description = 'Get information about all available realms';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseToolModule.GetAllRealmMetasResult> {
    let realmMetas = this.realm.allRealmsInfo;
    let commandModule = await this.loadToolModule();
    const { GetAllRealmMetasResult, RealmInfoField, RealmMetaField } =
      commandModule;

    return new GetAllRealmMetasResult({
      results: Object.entries(realmMetas).map(([url, realmMeta]) => {
        return new RealmMetaField({
          info: new RealmInfoField({ ...realmMeta.info }),
          canWrite: realmMeta.canWrite,
          realmIdentifier: url,
        });
      }),
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GetAllRealmMetasTool as GetAllRealmMetasCommand };

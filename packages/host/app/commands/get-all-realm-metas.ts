import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type Realm from '../services/realm';

export default class GetAllRealmMetasCommand extends HostBaseCommand<
  undefined,
  typeof BaseCommandModule.GetAllRealmMetasResult
> {
  @service declare private realm: Realm;

  static actionVerb = 'Get All Realms Info';
  static description = 'Get information about all available realms';

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseCommandModule.GetAllRealmMetasResult> {
    let realmMetas = this.realm.allRealmsInfo;
    let commandModule = await this.loadCommandModule();
    const { GetAllRealmMetasResult, RealmInfoField, RealmMetaField } =
      commandModule;

    return new GetAllRealmMetasResult({
      results: Object.entries(realmMetas).map(([url, realmMeta]) => {
        return new RealmMetaField({
          info: new RealmInfoField({ ...realmMeta.info }),
          canWrite: realmMeta.canWrite,
          url: url,
        });
      }),
    });
  }
}

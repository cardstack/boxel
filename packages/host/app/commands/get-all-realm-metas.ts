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
    let commandModule = await this.loadCommandModule();
    const { ShowCardInput } = commandModule;
    return ShowCardInput;
  }

  protected async run(): Promise<Record<string, any>> {
    let realmMetas = this.realm.allRealmsInfo;
    let commandModule = await this.loadCommandModule();
    const { GetAllRealmMetasResult, RealmInfoField, RealmMetaField } =
      commandModule;

    return new GetAllRealmMetasResult({
      results: Object.entries(realmMetas).map(([_, realmMeta]) => {
        return new RealmMetaField({
          info: new RealmInfoField({ ...realmMeta.info }),
          canWrite: realmMeta.canWrite,
        });
      }),
    });
  }
}

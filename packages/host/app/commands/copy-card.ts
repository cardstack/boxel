import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class CopyCardToRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopyCardToRealmInput,
  typeof BaseCommandModule.CopyCardResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  description = 'Copy a card to a realm';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopyCardToRealmInput } = commandModule;
    return CopyCardToRealmInput;
  }

  requireInputFields = ['sourceCard', 'targetRealm'];

  // Instances that are created via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.
  protected async run(
    input: BaseCommandModule.CopyCardToRealmInput,
  ): Promise<BaseCommandModule.CopyCardResult> {
    let targetRealm =
      input.targetRealm || this.realm.defaultWritableRealm?.path;
    if (!targetRealm) {
      throw new Error('No writable realm available to copy card to');
    }

    if (!this.realm.canWrite(targetRealm)) {
      throw new Error(`Do not have write permissions to ${targetRealm}`);
    }
    let doc = await this.cardService.serializeCard(input.sourceCard, {
      useAbsoluteURL: true,
    });
    delete doc.data.id;
    let newCardId = await this.store.create(doc, {
      realm: targetRealm,
      localDir: input.localDir,
    });
    if (typeof newCardId !== 'string') {
      throw new Error(
        `unable to save copied card instance: ${JSON.stringify(
          newCardId,
          null,
          2,
        )}`,
      );
    }
    let commandModule = await this.loadCommandModule();
    const { CopyCardResult } = commandModule;
    return new CopyCardResult({ newCardId });
  }
}

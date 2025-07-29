import { service } from '@ember/service';

import { isCardInstance, realmURL } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class CopyCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopyCardInput,
  typeof BaseCommandModule.CopyCardResult
> {
  @service declare private cardService: CardService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  description = 'Copy a card to a realm';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopyCardInput } = commandModule;
    return CopyCardInput;
  }

  async copyCard(sourceCard: CardDef, realm: string) {
    let doc = await this.cardService.serializeCard(input.sourceCard, {
      useAbsoluteURL: true,
    });
    delete doc.data.id;
    let newCardId = await this.store.create(doc, {
      realm: realmToCopyTo,
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
    return newCardId;
  }

  // Instances that are created via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.
  protected async run(
    input: BaseCommandModule.CopyCardInput,
  ): Promise<BaseCommandModule.CopyCardResult> {
    if (operatorModeStateService.state?.submode === 'interact') {
      let realmToCopyTo = await this.determineTargetRealm(input);
      let doc = await this.cardService.serializeCard(input.sourceCard, {
        useAbsoluteURL: true,
      });
      delete doc.data.id;
      let newCardId = await this.store.create(doc, {
        realm: realmToCopyTo,
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
    } else if (operatorModeStateService.state?.submode == 'code') {
    } else {
      console.error(
        'Unknown submode:',
        this.operatorModeStateService.state?.submode,
      );
    }
  }

  private async determineTargetRealm({
    targetStackIndex,
    targetRealm,
  }: BaseCommandModule.CopyCardInput) {
    if (targetRealm !== undefined && targetStackIndex !== undefined) {
      console.warn(
        'Both targetStackIndex and targetRealm are set; only one should be set -- using targetRealm',
      );
    }
    if (targetRealm) {
      return targetRealm;
    }
    if (targetStackIndex !== undefined) {
      // use existing card in stack to determine realm url,
      let item =
        this.operatorModeStateService.topMostStackItems()[targetStackIndex];
      if (item.id) {
        let topCard = await this.store.get(item.id);
        if (isCardInstance(topCard)) {
          let url = topCard[realmURL];
          // open card might be from a realm in which we don't have write permissions
          if (url && this.realm.canWrite(url.href)) {
            return url.href;
          }
        }
      }
    }
    if (!this.realm.defaultWritableRealm) {
      throw new Error('Could not find a writable realm');
    }
    return this.realm.defaultWritableRealm.path;
  }
}

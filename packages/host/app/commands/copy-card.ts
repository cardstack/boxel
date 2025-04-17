import { service } from '@ember/service';

import { isCardInstance, isResolvedCodeRef } from '@cardstack/runtime-common';

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

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopyCardInput } = commandModule;
    return CopyCardInput;
  }

  // Instances that are created via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.
  protected async run(
    input: BaseCommandModule.CopyCardInput,
  ): Promise<BaseCommandModule.CopyCardResult> {
    const targetUrl = await this.determineTargetUrl(input);
    let doc = await this.cardService.serializeCard(input.sourceCard, {
      useAbsoluteURL: true,
    });
    delete doc.data.id;
    if (input.codeRef) {
      if (!isResolvedCodeRef(input.codeRef)) {
        throw new Error('codeRef is not resolved');
      }
      doc.data.meta.adoptsFrom = input.codeRef;
    }
    let maybeId = await this.store.create(doc, undefined, targetUrl);
    if (typeof maybeId !== 'string') {
      throw new Error(
        `unable to save copied card instance: ${JSON.stringify(
          maybeId,
          null,
          2,
        )}`,
      );
    }
    let newCard = await this.store.peek(maybeId);
    if (!isCardInstance(newCard)) {
      throw new Error(
        `unable to get instance ${maybeId}: ${JSON.stringify(newCard, null, 2)}`,
      );
    }
    let commandModule = await this.loadCommandModule();
    const { CopyCardResult } = commandModule;
    return new CopyCardResult({ newCard });
  }

  private async determineTargetUrl({
    targetStackIndex,
    targetUrl,
  }: BaseCommandModule.CopyCardInput) {
    if (targetUrl !== undefined && targetStackIndex !== undefined) {
      console.warn(
        'Both targetStackIndex and targetUrl are set; only one should be set; using targetUrl',
      );
    }
    if (targetUrl) {
      return targetUrl;
    }
    if (targetStackIndex !== undefined) {
      // use existing card in stack to determine realm url,
      let item =
        this.operatorModeStateService.topMostStackItems()[targetStackIndex];
      if (item.url) {
        let topCard = await this.store.peek(item.url);
        if (isCardInstance(topCard)) {
          let url = await this.cardService.getRealmURL(topCard);
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

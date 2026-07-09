import { service } from '@ember/service';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type StoreService from '../services/store';

export default class StoreAddCommand extends HostBaseCommand<
  typeof BaseCommandModule.StoreAddInput,
  typeof CardDef
> {
  @service declare private store: StoreService;

  description = 'Add a card document to the store';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { StoreAddInput } = commandModule;
    return StoreAddInput;
  }

  requireInputFields = ['document'];

  protected async run(
    input: BaseCommandModule.StoreAddInput,
  ): Promise<CardDef> {
    const result = await this.store.add(
      input.document as LooseSingleCardDocument,
      input.realm ? { realm: input.realm } : undefined,
    );
    return result as CardDef;
  }
}

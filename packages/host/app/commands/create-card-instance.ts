import { service } from '@ember/service';

import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import CardService from '../services/card-service';

export default class CreateCardInstanceCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateInstanceInput
> {
  @service declare private cardService: CardService;

  description = `Create a new card instance given a card ref and realm.`;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateInstanceInput } = commandModule;
    return CreateInstanceInput;
  }

  protected async run(
    input: BaseCommandModule.CreateInstanceInput,
  ): Promise<undefined> {
    if (!input.module || !input.realm) {
      throw new Error(
        "Create instance command can't run because it doesn't have all the fields in arguments returned by open ai",
      );
    }
    let doc: LooseSingleCardDocument = {
      data: {
        meta: {
          adoptsFrom: input.module,
          realmURL: input.realm,
        },
      },
    };
    await this.cardService.createFromSerialized(doc.data, doc);
  }
}

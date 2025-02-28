import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

export default class CreateCardInstanceCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateInstanceInput,
  typeof CardDef | undefined
> {
  description = `Create a new card instance given a card ref and realm.`;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateInstanceInput } = commandModule;
    return CreateInstanceInput;
  }

  protected async run(
    input: BaseCommandModule.CreateInstanceInput,
  ): Promise<CardDef | undefined> {
    if (!input.parent || !input.module || !input.realm) {
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
    let cardResource = getCard(input.parent, () => doc, {
      isAutoSave: () => true,
    });
    await cardResource.loaded; // this await should not be necessary when card-resource is refactored
    return cardResource.card;
  }
}

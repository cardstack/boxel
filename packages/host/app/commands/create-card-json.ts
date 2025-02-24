import { type LooseSingleCardDocument } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

export default class CreateCardJsonCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateInstanceInput
> {
  description = `Create a new card json document given a card ref and realm.`;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateInstanceInput } = commandModule;
    return CreateInstanceInput;
  }

  protected async run(
    input: BaseCommandModule.CreateInstanceInput,
  ): Promise<LooseSingleCardDocument> {
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
    return doc;
  }
}

import { service } from '@ember/service';

import { Command, baseRealm } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type CardService from '../services/card-service';

import type LoaderService from '../services/loader-service';

export default class CreateModuleCommand extends Command<
  BaseCommandModule.CreateModuleInput,
  undefined,
  { cardType: typeof CardDef }
> {
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;

  description = `Create a new module, errors if there is an existing module with the same name.`;

  async getInputType() {
    let commandModule = await this.loaderService.loader.import<
      typeof BaseCommandModule
    >(`${baseRealm.url}command`);
    const { CreateModuleInput } = commandModule;
    // Can we define one on the fly?
    return CreateModuleInput;
  }

  protected async run(
    input: BaseCommandModule.CreateModuleInput,
  ): Promise<undefined> {
    // TODO: check if currently exists using authedFetch
    await this.cardService.saveSource(
      new URL(input.modulePath, input.realm),
      input.code,
    );
    // We have no return here, we need to return a reference to the module created
    // and potentially also identify exported cards from it
    // We should also return error messages if any
  }
}

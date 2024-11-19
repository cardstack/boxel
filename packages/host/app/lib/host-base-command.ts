import { getOwner, setOwner } from '@ember/-internals/owner';
import { service } from '@ember/service';

import { Command, type CommandContext } from '@cardstack/runtime-common';

import { baseRealm } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type LoaderService from '../services/loader-service';

export default abstract class HostBaseCommand<
  CardInputType extends CardDef | undefined,
  CardResultType extends CardDef | undefined,
  CommandConfiguration extends any | undefined = undefined,
> extends Command<CardInputType, CardResultType, CommandConfiguration> {
  constructor(
    protected readonly commandContext: CommandContext,
    protected readonly configuration?: CommandConfiguration | undefined, // we'd like this to be required *if* CommandConfiguration is defined, and allow the user to skip it when CommandConfiguration is undefined
  ) {
    super(commandContext, configuration);
    let ownerOfCommandContext = getOwner(commandContext);
    console.log({ ownerOfCommandContext });
    setOwner(this, ownerOfCommandContext!);
  }

  @service protected declare loaderService: LoaderService;

  protected loadCommandModule(): Promise<typeof BaseCommandModule> {
    return this.loaderService.loader.import<typeof BaseCommandModule>(
      `${baseRealm.url}command`,
    );
  }
}

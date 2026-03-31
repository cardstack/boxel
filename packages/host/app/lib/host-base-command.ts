import { getOwner, setOwner } from '@ember/-internals/owner';
import { service } from '@ember/service';

import { Command, type CommandContext } from '@cardstack/runtime-common';

import { baseRealm } from '@cardstack/runtime-common';

import type LoaderService from '../services/loader-service';
import type { CardDefConstructor } from '@cardstack/base/card-api';
import type * as BaseCommandModule from '@cardstack/base/command';

export default abstract class HostBaseCommand<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor | undefined = undefined,
> extends Command<CardInputType, CardResultType> {
  constructor(commandContext: CommandContext) {
    super(commandContext);
    setOwner(this, getOwner(commandContext)!);
  }

  @service declare protected loaderService: LoaderService;

  protected loadCommandModule(): Promise<typeof BaseCommandModule> {
    return this.loaderService.loader.import<typeof BaseCommandModule>(
      `${baseRealm.url}command`,
    );
  }
}

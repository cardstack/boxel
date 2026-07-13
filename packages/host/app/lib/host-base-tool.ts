import { getOwner, setOwner } from '@ember/-internals/owner';
import { service } from '@ember/service';

import { Command, type ToolContext } from '@cardstack/runtime-common';

import type LoaderService from '../services/loader-service';
import type { CardDefConstructor } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default abstract class HostBaseTool<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor | undefined = undefined,
> extends Command<CardInputType, CardResultType> {
  constructor(toolContext: ToolContext) {
    super(toolContext);
    setOwner(this, getOwner(toolContext)!);
  }

  @service declare protected loaderService: LoaderService;

  protected loadToolModule(): Promise<typeof BaseToolModule> {
    return this.loaderService.loader.import<typeof BaseToolModule>(
      '@cardstack/base/command',
    );
  }
}

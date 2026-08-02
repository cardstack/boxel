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
    // Tool input/result card types belong to the same canonical Base graph as
    // the opaque records that cross a realm sandbox boundary. Loading command
    // types through the legacy host loader can produce a second CardDef
    // identity, causing otherwise valid opaque cards to fail linksTo(CardDef)
    // validation before the host tool gets a chance to serialize them through
    // the explicit boundary adapter.
    return this.loaderService.baseLoader.import<typeof BaseToolModule>(
      '@cardstack/base/command',
    );
  }
}

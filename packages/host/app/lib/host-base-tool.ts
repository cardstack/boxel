import { getOwner, setOwner } from '@ember/-internals/owner';
import { service } from '@ember/service';

import { Command, type ToolContext } from '@cardstack/runtime-common';

import type LoaderService from '../services/loader-service';
import type { CardDefConstructor } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

// A file a tool's result attaches for the model to see with it. A file with a
// `url` is already uploaded to the room's media and rides as it is; one with
// only a `sourceUrl` is a realm file, uploaded when the result is sent.
export interface ResultAttachment {
  sourceUrl: string;
  url?: string;
  name?: string;
  contentType?: string;
  contentHash?: string;
  contentSize?: number;
}

export default abstract class HostBaseTool<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor | undefined = undefined,
> extends Command<CardInputType, CardResultType> {
  constructor(toolContext: ToolContext) {
    super(toolContext);
    setOwner(this, getOwner(toolContext)!);
  }

  @service declare protected loaderService: LoaderService;

  // A tool that must always wait for the user's click before it runs, even
  // in a mode that otherwise runs tools without approval, sets this to true.
  // Reserved for actions that destroy data and cannot be undone.
  static neverAutoExecutes = false;

  // The files this tool's result attaches for the model, such as files it
  // saved or images it captured. The tool service asks only tools the host
  // itself provides, so a command loaded from a realm cannot attach files
  // this way.
  resultAttachments(
    _result: CardResultType extends CardDefConstructor
      ? InstanceType<CardResultType>
      : never,
  ): ResultAttachment[] {
    return [];
  }

  protected loadToolModule(): Promise<typeof BaseToolModule> {
    return this.loaderService.loader.import<typeof BaseToolModule>(
      '@cardstack/base/command',
    );
  }
}

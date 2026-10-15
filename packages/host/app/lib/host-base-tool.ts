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

// A call in a tool's input that makes the tool wait for the user's click, and
// the reason the approval panel shows for it.
export interface ClickReason {
  call: string;
  reason: string;
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

  // The same rule for one call, for a tool where only some inputs destroy
  // data. It gets the call's input attributes as the model sent them, and is
  // asked again whenever they change, so a call whose input is still
  // streaming is never judged early.
  static neverAutoExecutesFor(
    _attributes: Record<string, unknown> | undefined,
  ): boolean {
    return false;
  }

  // Why `neverAutoExecutesFor` holds this call for the user's click, one
  // entry for each call in its input that needs the click. The approval panel
  // shows them, so the user knows what the click allows.
  static clickReasonsFor(
    _attributes: Record<string, unknown> | undefined,
  ): ClickReason[] {
    return [];
  }

  // Time this call may take beyond the tool service's execute timeout, for a
  // tool where some inputs do slow work, such as generating images. It gets
  // the call's input attributes as the model sent them.
  static extraExecuteTimeMsFor(
    _attributes: Record<string, unknown> | undefined,
  ): number {
    return 0;
  }

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

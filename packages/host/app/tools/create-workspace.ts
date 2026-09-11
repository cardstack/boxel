import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { generateRandomWorkspaceName } from '../lib/random-name';
import {
  cleanseString,
  getRandomBackgroundURL,
  iconURLFor,
} from '../lib/utils';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type * as BaseToolModule from '@cardstack/base/command';

// Creates a workspace (realm) owned by the current user, the same way the
// "New Workspace" tile in the workspace chooser does: the realm is created on
// the user's realm server and recorded in the user's realm list, so it shows
// up in the chooser right away. The new workspace is then opened, which puts
// its URL in the context sent back with the tool result — there is no result
// card; the assistant reads the URL from the "Workspace:" line of that
// context.
export default class CreateWorkspaceTool extends HostBaseTool<
  typeof BaseToolModule.CreateWorkspaceInput,
  undefined
> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Create';

  description =
    'Create a new workspace (realm) owned by the current user. Both fields are optional: a random display name is generated when `name` is omitted, and `endpoint` (the workspace URL path segment) is derived from the name when omitted. Opens the new workspace when done; its URL is the Workspace in the context returned with the tool result.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.CreateWorkspaceInput;
  }

  protected async run(
    input: BaseToolModule.CreateWorkspaceInput,
  ): Promise<undefined> {
    let name = input.name?.trim() || generateRandomWorkspaceName();
    // The server accepts only lowercase letters, digits and hyphens in an
    // endpoint. Normalize whatever was given (or the name) into that shape
    // rather than rejecting near-misses like "My Workspace".
    let endpoint = toEndpoint(input.endpoint?.trim() || name);
    if (!endpoint) {
      throw new Error(
        `Cannot derive a workspace endpoint from '${input.endpoint ?? name}'. Provide an endpoint made of letters, digits and hyphens.`,
      );
    }

    let realmURL = await this.matrixService.createPersonalRealmForUser({
      endpoint,
      name,
      iconURL: iconURLFor(name),
      backgroundURL: getRandomBackgroundURL(),
    });

    await this.operatorModeStateService.openWorkspace(realmURL.href);
    return undefined;
  }
}

function toEndpoint(value: string): string {
  return cleanseString(value)
    .replace(/_/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

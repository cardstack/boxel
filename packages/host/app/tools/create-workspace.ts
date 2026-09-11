import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { generateRandomWorkspaceName } from '../lib/random-name';
import {
  cleanseString,
  getRandomBackgroundURL,
  iconURLFor,
} from '../lib/utils';

import type MatrixService from '../services/matrix-service';
import type * as BaseToolModule from '@cardstack/base/command';

// Creates a workspace (realm) owned by the current user, with the same result
// as the "New Workspace" tile in the workspace chooser: the realm is created
// on the user's realm server, recorded in the user's realm list, and shows up
// in the chooser right away.
export default class CreateWorkspaceTool extends HostBaseTool<
  typeof BaseToolModule.CreateWorkspaceInput,
  typeof BaseToolModule.CreateWorkspaceResult
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Create';

  description =
    'Create a new workspace (realm) owned by the current user. Both fields are optional: a random display name is generated when `name` is omitted, and `endpoint` (the workspace URL path segment) is derived from the name when omitted. Returns the URL of the new workspace, which appears in the workspace chooser immediately.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.CreateWorkspaceInput;
  }

  protected async run(
    input: BaseToolModule.CreateWorkspaceInput,
  ): Promise<BaseToolModule.CreateWorkspaceResult> {
    let commandModule = await this.loadToolModule();
    let { CreateWorkspaceResult } = commandModule;

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

    return new CreateWorkspaceResult({
      realmURL: realmURL.href,
      name,
      endpoint,
    });
  }
}

function toEndpoint(value: string): string {
  return cleanseString(value)
    .replace(/_/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

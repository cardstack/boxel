import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { createWorkspace } from '../lib/workspaces';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

// Creates a workspace (realm) owned by the current user (see
// `createWorkspace`), then opens it, which puts its URL in the context sent
// back with the tool result — there is no result card; the assistant reads
// the URL from the "Workspace:" line of that context.
export default class CreateWorkspaceTool extends HostBaseTool<
  typeof BaseToolModule.CreateWorkspaceInput,
  undefined
> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

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
    let { url } = await createWorkspace(
      { matrixService: this.matrixService, realm: this.realm },
      input,
    );
    await this.operatorModeStateService.openWorkspace(url);
    return undefined;
  }
}

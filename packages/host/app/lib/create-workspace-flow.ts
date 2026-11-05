import { associateDestroyableChild } from '@ember/destroyable';
import { getOwner, setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import { generateRandomWorkspaceName } from '@cardstack/host/lib/random-name';
import {
  getRandomBackgroundURL,
  iconURLFor,
  toWorkspaceEndpoint,
} from '@cardstack/host/lib/utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

// The New Workspace flow behind the dashboard's and the workspace chooser's
// New Workspace buttons: the Add Workspace modal's fields, opened with a
// random name, and the task that creates the workspace and closes it.
export class CreateWorkspaceFlow {
  @service declare private matrixService: MatrixService;

  @tracked isModalOpen = false;
  @tracked endpoint = '';
  @tracked displayName = '';
  @tracked private hasUserEditedEndpoint = false;
  @tracked error: string | null = null;

  // Destroyed with `parent`, which cancels its task.
  constructor(parent: object) {
    let owner = getOwner(parent);
    if (!owner) {
      throw new Error('CreateWorkspaceFlow needs a parent with an owner');
    }
    setOwner(this, owner);
    associateDestroyableChild(parent, this);
  }

  setEndpoint = (value: string) => {
    this.hasUserEditedEndpoint = true;
    this.endpoint = value;
  };

  // The endpoint follows the name until the user edits it.
  setDisplayName = (value: string) => {
    this.displayName = value;
    if (!this.hasUserEditedEndpoint) {
      this.endpoint = toWorkspaceEndpoint(value);
    }
  };

  setIsModalOpen = (value: boolean) => {
    this.isModalOpen = value;
    if (value) {
      this.error = null;
      this.hasUserEditedEndpoint = false;
      this.setDisplayName(generateRandomWorkspaceName());
    }
  };

  createWorkspaceTask = task(async () => {
    this.error = null;
    try {
      await this.matrixService.createPersonalRealmForUser({
        endpoint: this.endpoint,
        name: this.displayName,
        iconURL: iconURLFor(this.displayName),
        backgroundURL: getRandomBackgroundURL(),
      });
      this.isModalOpen = false;
    } catch (e: any) {
      this.error = e.message;
    }
  });
}

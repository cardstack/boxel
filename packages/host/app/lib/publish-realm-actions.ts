import { associateDestroyableChild } from '@ember/destroyable';
import { action } from '@ember/object';
import { getOwner, setOwner } from '@ember/owner';
import { service } from '@ember/service';

import { restartableTask } from 'ember-concurrency';

import type { PublishError } from '@cardstack/host/components/operator-mode/publish-realm-modal';
import type ToolService from '@cardstack/host/services/tool-service';
import PublishRealmTool from '@cardstack/host/tools/publish-realm';
import UnpublishRealmTool from '@cardstack/host/tools/unpublish-realm';

// Publishing and unpublishing one workspace, and the error the last publish
// left. The realm-publishing service keeps one per workspace for the session;
// get it there rather than making one.
export class PublishRealmActions {
  @service declare private toolService: ToolService;

  #realmURL: string;

  // Destroyed with `parent`, which cancels its tasks.
  constructor(parent: object, realmURL: string) {
    let owner = getOwner(parent);
    if (!owner) {
      throw new Error('PublishRealmActions needs a parent with an owner');
    }
    setOwner(this, owner);
    associateDestroyableChild(parent, this);
    this.#realmURL = realmURL;
  }

  publishTask = restartableTask(async (publishedRealmURLs: string[]) => {
    // Publish through the same command exposed to boxel-cli so the UI and
    // headless callers share one path. The modal already enforces the
    // publishability gate, so force past the command's redundant re-check.
    let command = new PublishRealmTool(this.toolService.toolContext);
    let result = await command.execute({
      realmURL: this.#realmURL,
      publishedRealmURLs,
      force: true,
    });

    let errors = new Map<string, string>();
    for (let target of result.results) {
      if (target.status === 'error' || target.status === 'published-pending') {
        errors.set(
          target.publishedRealmURL,
          target.error || 'Failed to publish to this domain',
        );
      }
    }

    if (errors.size > 0) {
      let error = new Error(
        'Failed to publish to some domains',
      ) as PublishError;
      error.urlErrors = errors;
      throw error;
    }
  });

  @action publish(publishedRealmURLs: string[]) {
    // The modal shows the error, so it isn't left to reach the browser's
    // error reporting as an unhandled rejection.
    this.publishTask.perform(publishedRealmURLs).catch(() => {});
  }

  get publishError(): PublishError | null {
    return this.publishTask.last?.error as PublishError | null;
  }

  unpublishTask = restartableTask(async (publishedRealmURL: string) => {
    // Unpublish through the same command exposed to boxel-cli so the UI and
    // headless callers share one path.
    let command = new UnpublishRealmTool(this.toolService.toolContext);
    await command.execute({
      realmURL: this.#realmURL,
      publishedRealmURL,
    });
  });
}

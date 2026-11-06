import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import PublishRealmModal from '@cardstack/host/components/operator-mode/publish-realm-modal';
import type ToolService from '@cardstack/host/services/tool-service';
import PublishRealmTool from '@cardstack/host/tools/publish-realm';
import UnpublishRealmTool from '@cardstack/host/tools/unpublish-realm';

import type { PublishError } from './publish-realm-modal';

interface Signature {
  Args: {
    // The workspace to publish.
    realmURL: string;
    isOpen: boolean;
    onClose: () => void;
    // Called once every chosen domain has published.
    onPublished?: () => void;
  };
}

// The publish dialog for one workspace, with the publish and unpublish
// commands it runs.
export default class PublishRealmDialog extends Component<Signature> {
  @service declare private toolService: ToolService;

  private publishTask = restartableTask(
    async (publishedRealmURLs: string[]) => {
      // Publish through the same command exposed to boxel-cli so the UI and
      // headless callers share one path. The modal already enforces the
      // publishability gate, so force past the command's redundant re-check.
      let command = new PublishRealmTool(this.toolService.toolContext);
      let result = await command.execute({
        realmURL: this.args.realmURL,
        publishedRealmURLs,
        force: true,
      });

      let errors = new Map<string, string>();
      for (let target of result.results) {
        if (
          target.status === 'error' ||
          target.status === 'published-pending'
        ) {
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

      this.args.onPublished?.();
    },
  );

  @action private publish(publishedRealmURLs: string[]) {
    // The modal shows the error, so it isn't left to reach the browser's
    // error reporting as an unhandled rejection.
    this.publishTask.perform(publishedRealmURLs).catch(() => {});
  }

  private get publishError(): PublishError | null {
    return this.publishTask.last?.error as PublishError | null;
  }

  private unpublishTask = restartableTask(async (publishedRealmURL: string) => {
    // Unpublish through the same command exposed to boxel-cli so the UI and
    // headless callers share one path.
    let command = new UnpublishRealmTool(this.toolService.toolContext);
    await command.execute({ realmURL: this.args.realmURL, publishedRealmURL });
  });

  <template>
    <PublishRealmModal
      @realmURL={{@realmURL}}
      @isOpen={{@isOpen}}
      @onClose={{@onClose}}
      @handlePublish={{this.publish}}
      @publishError={{this.publishError}}
      @handleUnpublish={{perform this.unpublishTask}}
    />
  </template>
}

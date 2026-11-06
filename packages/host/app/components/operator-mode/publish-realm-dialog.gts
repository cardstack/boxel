import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import { modalFocusTrapOptions } from '@cardstack/host/components/operator-mode/dashboard-modals/workspace-modals';

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
    // Where focus goes when the dialog closes, when not back to where it was.
    returnFocusTarget?: () => HTMLElement | undefined;
    // Called once every chosen domain has published.
    onPublished?: () => void;
  };
}

// The publish dialog for one workspace, with the publish and unpublish
// commands it runs. Focus moves into it on open, stays in it, and Escape
// closes it.
export default class PublishRealmDialog extends Component<Signature> {
  @service declare private toolService: ToolService;

  private dialogId = guidFor(this);

  private get focusTrapOptions() {
    return modalFocusTrapOptions(this.dialogId, this.args);
  }

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
      aria-label='Publish workspace'
      id={{this.dialogId}}
      tabindex='-1'
      {{focusTrap focusTrapOptions=this.focusTrapOptions}}
    />
  </template>
}

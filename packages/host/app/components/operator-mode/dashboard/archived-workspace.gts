import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import ArchiveRestoreIcon from '@cardstack/boxel-icons/archive-restore';
import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { LoadingIndicator, RealmIcon } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

import RealmURLTooltip from '@cardstack/host/components/realm-url-tooltip';
import type {
  ArchivedRealmInfo,
  default as RealmServerService,
} from '@cardstack/host/services/realm-server';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    archivedRealm: ArchivedRealmInfo;
  };
}

// An archived workspace, as a row like the workspaces above it. Archived
// realms are sealed, so the row renders from the metadata
// `GET /_archived-realms` returns and offers Restore alone. It stays out of
// the keyboard cursor's walk.
export default class ArchivedWorkspace extends Component<Signature> {
  @service declare private realmServer: RealmServerService;

  @tracked private restoreError: string | undefined;

  @cached
  private get realmInfo() {
    return {
      name: this.args.archivedRealm.name,
      iconURL: this.args.archivedRealm.iconURL,
      publishable: null,
    };
  }

  private get name() {
    return this.args.archivedRealm.name;
  }

  private get backgroundImageURL() {
    let { backgroundURL } = this.args.archivedRealm;
    return backgroundURL ? `url(${backgroundURL})` : '';
  }

  private restoreTask = dropTask(async () => {
    this.restoreError = undefined;
    try {
      await this.realmServer.unarchiveRealm(this.args.archivedRealm.url);
    } catch (error: any) {
      // Restoring can fail, as for a non-owner, so the row says so.
      this.restoreError = error.message;
    }
  });

  <template>
    <div class='archived-row' data-test-archived-workspace={{this.name}}>
      <span
        class='thumb'
        style={{cssVar workspace-background-image-url=this.backgroundImageURL}}
        aria-hidden='true'
      >
        <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
      </span>
      <div class='info'>
        <RealmURLTooltip
          class='name-tooltip'
          @realmURL={{@archivedRealm.url}}
          @label={{this.name}}
          @announce={{true}}
        >
          <span class='name' data-test-archived-workspace-name>
            {{this.name}}
          </span>
        </RealmURLTooltip>
        {{#if this.restoreError}}
          <span
            class='restore-error'
            role='alert'
            data-test-restore-workspace-error
          >{{this.restoreError}}</span>
        {{else}}
          <span class='status'>Archived</span>
        {{/if}}
      </div>
      {{#if this.restoreTask.isRunning}}
        <LoadingIndicator class='restore-spinner' @color='var(--boxel-light)' />
      {{else}}
        <button
          type='button'
          class='restore-btn'
          {{on 'click' (perform this.restoreTask)}}
          data-test-restore-workspace-btn={{@archivedRealm.url}}
        >
          <ArchiveRestoreIcon width='14' height='14' aria-hidden='true' />
          Restore
        </button>
      {{/if}}
    </div>
    <style scoped>
      .archived-row {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        min-width: 0;
        height: var(--dashboard-row-height);
        padding: var(--boxel-sp-xs);
        border-radius: var(--dashboard-tile-radius);
        box-shadow: inset 0 0 0 1px
          color-mix(in oklch, var(--boxel-light) 8%, transparent);
        color: var(--boxel-light);
      }
      /* Dimmed, so an archived workspace reads as inactive. */
      .thumb {
        position: relative;
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: calc(var(--dashboard-row-height) - 2 * var(--boxel-sp-xs));
        height: 100%;
        overflow: hidden;
        border-radius: 0.75rem;
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        filter: grayscale(0.6) brightness(0.6);
      }
      .realm-icon {
        --boxel-realm-icon-size: 1.5rem;
        --boxel-realm-icon-border-radius: var(--boxel-border-radius-sm);
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .info {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }
      .name-tooltip {
        width: 100%;
        min-width: 0;
      }
      .name {
        display: block;
        overflow: hidden;
        color: var(--boxel-light);
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status {
        color: var(--boxel-400);
        font: 400 var(--boxel-font-xs);
      }
      .restore-error {
        overflow: hidden;
        color: var(--boxel-danger);
        font: 600 var(--boxel-font-xs);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .restore-btn {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        border: 1px solid var(--boxel-light-50);
        border-radius: var(--boxel-border-radius-2xl);
        background-color: transparent;
        color: var(--boxel-light);
        --icon-color: var(--boxel-light);
        font: 600 var(--boxel-font-xs);
        cursor: pointer;
      }
      .restore-btn:hover {
        border-color: var(--boxel-highlight);
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
        --icon-color: var(--boxel-highlight-foreground);
      }
      .restore-spinner {
        --boxel-loading-indicator-size: 1.5rem;
        flex: none;
      }
    </style>
  </template>
}

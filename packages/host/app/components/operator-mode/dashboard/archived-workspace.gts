import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import ArchiveRestoreIcon from '@cardstack/boxel-icons/archive-restore';
import { Button } from '@cardstack/pretui/components/button';
import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { RealmIcon } from '@cardstack/boxel-ui/components';

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

// An archived workspace, as a row like the workspaces above it; the section
// says it is archived. Archived realms are sealed, so the row renders from the
// metadata `GET /_archived-realms` returns and offers Restore alone. It stays
// out of the keyboard cursor's walk.
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
    <div
      class='archived-row'
      data-test-archived-workspace={{this.name}}
      ...attributes
    >
      <span class='thumb'>
        <RealmURLTooltip
          @realmURL={{@archivedRealm.url}}
          @label={{this.name}}
          @announce={{true}}
        >
          <span class='realm-icon-wrapper' aria-hidden='true'>
            <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
          </span>
        </RealmURLTooltip>
      </span>
      <div class='info'>
        <span class='name' data-test-archived-workspace-name>
          {{this.name}}
        </span>
        {{#if this.restoreError}}
          <span
            class='restore-error'
            role='alert'
            data-test-restore-workspace-error
          >{{this.restoreError}}</span>
        {{/if}}
      </div>
      {{! Busy, not replaced, so focus stays on it. }}
      <Button
        class='restore-btn'
        @appearance='outlined'
        @shape='pill'
        @size='s'
        @busy={{this.restoreTask.isRunning}}
        @busyLabel='Restoring'
        {{on 'click' (perform this.restoreTask)}}
        data-test-restore-workspace-btn={{@archivedRealm.url}}
      >
        <ArchiveRestoreIcon width='14' height='14' aria-hidden='true' />
        Restore
      </Button>
    </div>
    <style scoped>
      .archived-row {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        min-width: 0;
        min-height: var(--dashboard-row-height);
        padding: var(--boxel-sp-xs);
        border-radius: var(--dashboard-tile-radius);
        background-color: var(--dashboard-row-tint);
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
        color: var(--boxel-light);
      }
      .thumb {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: calc(var(--dashboard-row-height) - 2 * var(--boxel-sp-xs));
        height: 100%;
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--dashboard-thumb-tint);
      }
      .realm-icon-wrapper {
        position: relative;
        display: flex;
        border-radius: var(--boxel-border-radius-sm);
        box-shadow: 0 0.125rem 0.375rem var(--boxel-dark-40);
      }
      .realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px var(--boxel-light-50);
        pointer-events: none;
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
      .name {
        display: block;
        overflow: hidden;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Wraps, so a long server error reads whole. */
      .restore-error {
        color: var(--boxel-danger);
        font: 600 var(--boxel-font-xs);
        overflow-wrap: break-word;
      }
      .restore-btn {
        flex: none;
      }
    </style>
  </template>
}

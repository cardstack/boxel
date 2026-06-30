import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import ArchiveRestoreIcon from '@cardstack/boxel-icons/archive-restore';
import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import {
  LoadingIndicator,
  RealmIcon,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

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

// A workspace-chooser tile for an archived realm. Archived realms are sealed
// (their `_info` / session endpoints answer 403), so this tile renders purely
// from the display metadata returned by `GET /_archived-realms` and offers a
// single Restore action rather than the active tile's open/favorite/host
// affordances.
export default class ArchivedWorkspace extends Component<Signature> {
  @service declare private realmServer: RealmServerService;

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
    await this.realmServer.unarchiveRealm(this.args.archivedRealm.url);
  });

  <template>
    <div class='archived-card' data-test-archived-workspace={{this.name}}>
      <div
        class='tile'
        style={{cssVar workspace-background-image-url=this.backgroundImageURL}}
      >
        <div class='tile-overlay'></div>
        <Tooltip @placement='top'>
          <:trigger>
            <span class='archive-badge'>
              <ArchiveIcon width='14' height='14' />
            </span>
          </:trigger>
          <:content>Archived workspace</:content>
        </Tooltip>
        <div class='realm-icon-wrapper'>
          <RealmIcon
            class='workspace-realm-icon'
            @realmInfo={{this.realmInfo}}
          />
        </div>
        {{#if this.restoreTask.isRunning}}
          <div class='restore-pending'>
            <LoadingIndicator class='restore-spinner' />
          </div>
        {{else}}
          <button
            type='button'
            class='restore-btn'
            data-test-restore-workspace-btn={{@archivedRealm.url}}
            {{on 'click' (perform this.restoreTask)}}
          >
            <ArchiveRestoreIcon width='14' height='14' />
            Restore
          </button>
        {{/if}}
      </div>
      <div class='info'>
        <span
          class='name'
          data-test-archived-workspace-name
        >{{this.name}}</span>
        <span class='status'>Archived</span>
      </div>
    </div>
    <style scoped>
      .archived-card {
        display: flex;
        flex-direction: column;
        width: fit-content;
        position: relative;
      }
      .tile {
        min-width: var(--boxel-xxs-container);
        width: var(--boxel-xxs-container);
        height: 10.375rem;
        border-radius: var(--boxel-border-radius-xl);
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        position: relative;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
      }
      .tile::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: var(--boxel-border-radius-xl);
        border: 1px solid rgba(255 255 255 / 25%);
        pointer-events: none;
        z-index: 3;
      }
      /* Dim the tile so an archived workspace reads as inactive. */
      .tile-overlay {
        position: absolute;
        inset: 0;
        background: rgba(24 25 32 / 55%);
        z-index: 1;
      }
      .archive-badge {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: var(--boxel-border-radius-sm);
        background: rgba(0 0 0 / 45%);
        backdrop-filter: blur(6px);
        color: var(--boxel-light);
        --icon-color: var(--boxel-light);
      }
      .realm-icon-wrapper {
        flex-shrink: 0;
        position: relative;
        z-index: 2;
        border-radius: calc(
          var(--boxel-border-radius-xs) + var(--boxel-border-radius-sm)
        );
        display: flex;
        box-shadow: 0 2px 6px rgb(0 0 0 / 30%);
        opacity: 0.85;
      }
      .realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px rgba(255 255 255 / 50%);
        z-index: 1;
        pointer-events: none;
      }
      .workspace-realm-icon {
        --boxel-realm-icon-size: 2.625rem;
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xs) + 6px
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .restore-btn {
        position: absolute;
        bottom: 0.5rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        border: 1px solid rgba(255 255 255 / 45%);
        border-radius: var(--boxel-border-radius-xxl);
        background: rgba(0 0 0 / 55%);
        backdrop-filter: blur(6px);
        color: var(--boxel-light);
        --icon-color: var(--boxel-light);
        font: 700 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .archived-card:hover .restore-btn,
      .restore-btn:focus-visible {
        opacity: 1;
      }
      .restore-btn:hover {
        background: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
        border-color: var(--boxel-highlight);
        --icon-color: var(--boxel-highlight-foreground);
      }
      .restore-pending {
        position: absolute;
        bottom: 0.5rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2;
      }
      .restore-spinner {
        --boxel-loading-indicator-size: 1.5rem;
      }
      .info {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: var(--boxel-sp-xs);
        gap: var(--boxel-sp-5xs);
        max-width: var(--boxel-xxs-container);
      }
      .info > span {
        text-overflow: ellipsis;
        overflow: hidden;
        width: 100%;
        text-align: center;
        letter-spacing: var(--boxel-lsp);
      }
      .info > .name {
        color: var(--boxel-light);
        font: 400 var(--boxel-font-sm);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        text-wrap: wrap;
        overflow-wrap: anywhere;
      }
      .status {
        color: var(--boxel-400);
        font: 400 var(--boxel-font-xs);
        text-transform: capitalize;
      }
    </style>
  </template>
}

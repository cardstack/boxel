import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import Home from '@cardstack/boxel-icons/home';
import { dropTask, task } from 'ember-concurrency';
import pluralize from 'pluralize';

import {
  BoxelDropdown,
  ContextButton,
  Menu,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { MenuItem, cssVar, gt } from '@cardstack/boxel-ui/helpers';
import {
  Group,
  IconGlobe,
  IconTrash,
  Lock,
  Star,
  StarFilled,
} from '@cardstack/boxel-ui/icons';

import {
  hasExecutableExtension,
  SupportedMimeType,
} from '@cardstack/runtime-common';

import DeleteModal from '@cardstack/host/components/operator-mode/delete-modal';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import ItemContainer from './item-container';
import WorkspaceLoadingIndicator from './workspace-loading-indicator';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmURL: string;
    showMenu?: boolean;
  };
}

export default class Workspace extends Component<Signature> {
  <template>
    {{#if this.loadRealmTask.isRunning}}
      <WorkspaceLoadingIndicator />
    {{else}}
      <div
        class='workspace-card {{if this.isHostDropdownOpen "is-open"}}'
        {{on 'mouseleave' this.closeHostDropdown}}
        ...attributes
      >
        <ItemContainer
          data-test-workspace={{this.name}}
          {{on 'click' this.openWorkspace}}
        >
          <div
            class='tile-icon'
            style={{cssVar
              workspace-background-image-url=this.backgroundImageURL
            }}
          >
            <div class='realm-icon-wrapper'>
              <RealmIcon
                class='workspace-realm-icon'
                @realmInfo={{this.realmInfo}}
              />
            </div>
          </div>
        </ItemContainer>
        <button
          class='tile-favorite-btn {{if this.isFavorited "is-favorited"}}'
          type='button'
          {{on 'click' this.toggleFavorite}}
          aria-label={{if this.isFavorited 'Unfavorite' 'Favorite'}}
          data-test-workspace-favorite-btn={{@realmURL}}
        >
          {{#if this.isFavorited}}
            <StarFilled width='16' height='16' />
          {{else}}
            <Star width='16' height='16' />
          {{/if}}
        </button>
        <div class='tile-menu-btn'>
          <BoxelDropdown @autoClose={{true}}>
            <:trigger as |bindings|>
              <ContextButton
                @label='Options'
                @variant='ghost'
                @width='16'
                @height='16'
                data-test-workspace-menu-trigger={{@realmURL}}
                {{bindings}}
              />
            </:trigger>
            <:content as |dd|>
              <Menu @items={{this.tileMenuItems}} @closeMenu={{dd.close}} />
            </:content>
          </BoxelDropdown>
        </div>
        {{#if this.hasPublishedRealms}}
          <button
            class='host-trigger'
            type='button'
            data-test-host-trigger={{@realmURL}}
            {{on 'click' this.toggleHostDropdown}}
          >
            <span class='trigger-house'><Home width='13' height='13' /></span>
            <span class='trigger-url'>{{this.displayPublishedURL}}</span>
            {{#if (gt this.publishedRealmURLs.length 1)}}
              <span class='trigger-chevron'>&#x25BE;</span>
            {{/if}}
          </button>

          {{#if this.isHostDropdownOpen}}
            <div class='host-dropdown' data-test-host-dropdown={{@realmURL}}>
              <span class='dropdown-header'>Launch in new window</span>
              <ul class='dropdown-list'>
                {{#each this.publishedRealmURLs as |url|}}
                  <li>
                    <button
                      type='button'
                      class='dropdown-option'
                      data-test-host-dropdown-option={{url}}
                      {{on 'click' (fn this.openPublishedRealm url)}}
                    >
                      <span class='option-url'>{{url}}</span>
                    </button>
                  </li>
                {{/each}}
              </ul>
            </div>
          {{/if}}
        {{/if}}

        <div class='info {{if this.isHostDropdownOpen "info--hidden"}}'>
          <span class='name' data-test-workspace-name>{{this.name}}</span>
          <span class='visibility' data-test-workspace-visibility>
            {{#if this.hasPublishedRealms}}
              <span class='hosted-icon'>
                <Home width='13' height='13' />
              </span>
            {{/if}}
            <this.visibilityIcon width='12' height='12' />
            {{this.visibility}}
          </span>
        </div>
      </div>
      {{#if this.showDeleteModal}}
        <DeleteModal
          @itemToDelete={{this.workspaceToDelete}}
          @onCancel={{this.closeDeleteModal}}
          @onConfirm={{this.confirmDeleteWorkspace}}
          @isDeleteRunning={{this.deleteWorkspaceTask.isRunning}}
          @error={{this.deleteError}}
          @size='medium'
          @containerClass='workspace-delete-dialog'
        >
          <:content>
            <div class='workspace-delete-copy'>
              <header class='workspace-delete-header'>
                <p class='workspace-delete-title'>Delete Workspace</p>
              </header>

              <section class='workspace-delete-summary-card'>
                <div class='workspace-delete-summary-row'>
                  <RealmIcon
                    class='workspace-delete-summary-icon'
                    @realmInfo={{this.realmInfo}}
                  />
                  <div class='workspace-delete-summary-body'>
                    <p class='workspace-delete-summary-name'>{{this.name}}</p>
                    {{#if this.loadDeleteSummaryTask.isRunning}}
                      <p class='workspace-delete-summary-text'>
                        Checking what will be removed from this workspace...
                      </p>
                    {{else if this.deleteSummaryText}}
                      <p class='workspace-delete-summary-text'>
                        Contains
                        {{this.deleteSummaryText}}
                      </p>
                    {{/if}}
                  </div>
                </div>
              </section>

              <div class='workspace-delete-danger-panel'>
                <p class='workspace-delete-warning'>
                  This permanently deletes the workspace and any custom domains
                  tied to it.
                </p>

                {{#if this.hasPublishedRealms}}
                  <div class='workspace-delete-published'>
                    <p class='workspace-delete-published-title'>
                      Published
                      {{pluralize 'realm' this.publishedRealmURLs.length}}
                      that will also be removed
                    </p>
                    <ul class='workspace-delete-published-list'>
                      {{#each this.publishedRealmURLs as |publishedRealmURL|}}
                        <li>
                          <a
                            href={{publishedRealmURL}}
                            target='_blank'
                            rel='noopener noreferrer'
                          >
                            {{publishedRealmURL}}
                          </a>
                        </li>
                      {{/each}}
                    </ul>
                  </div>
                {{/if}}

                <p
                  class='workspace-delete-warning workspace-delete-warning--strong'
                >
                  Links to cards in this workspace may stop working elsewhere.
                </p>
              </div>
            </div>
          </:content>
        </DeleteModal>
      {{/if}}
    {{/if}}
    <style scoped>
      .workspace-card {
        display: flex;
        flex-direction: column;
        width: fit-content;
        position: relative;
        cursor: pointer;
        --item-container-border-color: transparent;
        --item-container-border-hover-color: transparent;
      }
      .workspace-card::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 250px;
        height: 166px;
        box-sizing: border-box;
        border-radius: 15px;
        border: 1px solid rgba(255 255 255 / 25%);
        pointer-events: none;
        z-index: 20;
      }
      .workspace-card:hover::after {
        border-color: rgba(255 255 255 / 50%);
      }
      .tile-favorite-btn {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 3;
        color: white;
        --icon-color: white;
        opacity: 0;
        transition: opacity 0.15s ease;
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .workspace-card:hover .tile-favorite-btn {
        opacity: 1;
      }
      .tile-favorite-btn:hover {
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
        border-radius: 6px;
      }
      .tile-favorite-btn.is-favorited {
        color: #00ffba;
        --icon-color: #00ffba;
        opacity: 1;
      }
      .tile-menu-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 3;
        color: white;
        opacity: 0;
        transition: opacity 0.15s ease;
        border-radius: 6px;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        --boxel-icon-button-width: 24px;
        --boxel-icon-button-height: 24px;
      }
      .workspace-card:hover .tile-menu-btn,
      .tile-menu-btn:focus-within {
        opacity: 1;
      }
      .tile-menu-btn:hover {
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
      }
      .tile-icon {
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;

        position: relative;
        height: 100%;
        width: 100%;

        display: flex;
        justify-content: center;
        align-items: center;
      }
      .realm-icon-wrapper {
        flex-shrink: 0;
        position: relative;
        z-index: 1;
        border-radius: calc(var(--boxel-border-radius-xs) + 6px);
        display: flex;
        box-shadow: 0 2px 6px rgb(0 0 0 / 30%);
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
        --boxel-realm-icon-size: 42px;
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xs) + 6px
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .info {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: var(--boxel-sp-xs);
        gap: var(--boxel-sp-5xs);
      }
      .info > span {
        text-overflow: ellipsis;
        overflow: hidden;
        width: 100%;
        text-wrap: nowrap;
        text-align: center;
        letter-spacing: 0.4pt;
      }
      .name {
        color: var(--boxel-light);
        font: 400 var(--boxel-font-sm);
      }
      .visibility {
        color: var(--boxel-400);
        font: 400 var(--boxel-font-xs);
        text-transform: capitalize;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-5xs);
        --icon-color: var(--boxel-400);
      }
      .hosted-icon {
        color: #00ffba;
        display: flex;
        align-items: center;
        margin-right: 2px;
      }
      .info--hidden {
        visibility: hidden;
      }
      .host-trigger {
        position: absolute;
        top: calc(166px - 36px);
        left: 0;
        width: 250px;
        height: 36px;
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
        border: none;
        border-radius: 0 0 15px 15px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 10px 0 15px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.5s ease;
        z-index: 7;
        overflow: hidden;
      }
      .workspace-card:hover .host-trigger,
      .workspace-card.is-open .host-trigger {
        opacity: 1;
        transition: none;
      }
      .trigger-house {
        color: #00ffba;
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }
      .trigger-url {
        font-size: 11px;
        color: white;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        text-align: left;
      }
      .trigger-chevron {
        font-size: 12px;
        color: white;
        flex-shrink: 0;
      }
      .host-dropdown {
        position: absolute;
        top: 166px;
        left: 0;
        width: 250px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0 0 0 / 25%);
        z-index: 10;
        padding: 10px 0 6px;
        display: flex;
        flex-direction: column;
      }
      .dropdown-header {
        font-size: 11px;
        font-weight: 600;
        color: #444;
        padding: 0 12px 8px;
        border-bottom: 1px solid rgba(0 0 0 / 8%);
        display: block;
      }
      .dropdown-list {
        list-style: none;
        margin: 0;
        padding: 4px 6px;
      }
      .dropdown-list li {
        margin: 0;
        padding: 0;
      }
      .dropdown-option {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: none;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        text-align: left;
      }
      .dropdown-option:hover {
        background: rgba(0 0 0 / 6%);
      }
      .option-url {
        font-size: 12px;
        color: #1a1628;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workspace-menu {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        z-index: 1;
      }
      .workspace-menu__trigger {
        --boxel-icon-button-width: 2.65rem;
        --boxel-icon-button-height: 1.85rem;
        --boxel-icon-button-padding: 0 0.38rem;
        color: var(--boxel-light-100);
        background: rgb(24 25 32 / 86%);
        border: 1px solid rgb(255 255 255 / 62%);
        border-radius: 6px;
        box-shadow: 0 6px 14px rgb(0 0 0 / 22%);
        backdrop-filter: blur(10px);
      }
      .workspace-menu__trigger :deep(svg) {
        width: 1.7rem;
        height: 1.7rem;
      }
      .workspace-menu__trigger:hover,
      .workspace-menu__trigger[aria-expanded='true'] {
        color: var(--boxel-dark);
        background: var(--boxel-highlight);
        border-color: rgb(255 255 255 / 78%);
      }
      :global(.workspace-menu__content) {
        min-width: 11rem;
      }
      .workspace-menu__list {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .workspace-delete-copy {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        margin: 0;
        text-align: left;
      }
      .workspace-delete-copy p {
        margin: 0;
      }
      .workspace-delete-header {
        padding-bottom: var(--boxel-sp);
      }
      .workspace-delete-title {
        color: var(--boxel-dark);
        font-weight: 600;
        font-size: var(--boxel-font-size-xl);
        line-height: 1.1;
        font-family: var(--boxel-font-family);
        letter-spacing: -0.02em;
      }
      .workspace-delete-summary-card {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        color: var(--boxel-dark);
        background: var(--boxel-50);
        border: var(--boxel-border-card);
        border-radius: var(--boxel-border-radius-xxl);
      }
      .workspace-delete-summary-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .workspace-delete-summary-icon {
        flex-shrink: 0;
        --boxel-realm-icon-size: var(--boxel-icon-lg);
        --boxel-realm-icon-border-radius: 999px;
        box-shadow: 0 0 0 2px rgb(255 255 255 / 90%);
      }
      .workspace-delete-summary-body {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
      }
      .workspace-delete-summary-name {
        color: var(--boxel-dark);
        font-weight: 700;
        font-size: 1.125rem;
        line-height: 1.15;
        font-family: var(--boxel-font-family);
        letter-spacing: -0.02em;
      }
      .workspace-delete-summary-text {
        color: var(--boxel-450);
        font-weight: 400;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-family: var(--boxel-font-family);
      }
      .workspace-delete-danger-panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        background: rgb(255 90 90 / 9%);
        border: 1px solid rgb(255 90 90 / 18%);
        border-radius: var(--boxel-border-radius-xxl);
      }
      .workspace-delete-warning {
        color: var(--boxel-dark);
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-family: var(--boxel-font-family);
      }
      .workspace-delete-warning--strong {
        font-weight: 700;
        font-size: var(--boxel-font-size);
        line-height: var(--boxel-line-height);
      }
      .workspace-delete-published {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
      }
      .workspace-delete-published-title {
        color: var(--boxel-dark);
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.25;
        font-family: var(--boxel-font-family);
      }
      .workspace-delete-published-list {
        margin: 0;
        padding-left: var(--boxel-sp);
        text-align: left;
      }
      .workspace-delete-published-list li + li {
        margin-top: var(--boxel-sp-5xs);
      }
      .workspace-delete-published-list a {
        color: var(--boxel-blue);
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-family: var(--boxel-font-family);
        word-break: break-all;
        text-decoration-thickness: 1px;
        text-underline-offset: 0.12em;
      }
      :global(.workspace-delete-dialog) {
        background-color: var(--boxel-light-100);
        padding: var(--boxel-sp-2xl) var(--boxel-sp-2xl) var(--boxel-sp-xl);
        border-radius: var(--boxel-border-radius-xxl);
      }
    </style>
  </template>

  get isFavorited() {
    return this.matrixService.workspaceFavorites.includes(this.args.realmURL);
  }

  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private showDeleteModal = false;
  @tracked private deleteError: string | undefined;
  @tracked private deleteSummary: WorkspaceDeleteSummary | undefined;
  @tracked private isHostDropdownOpen = false;

  constructor(...args: [any, any]) {
    super(...args);
    this.loadRealmTask.perform();
  }

  private loadRealmTask = task(async () => {
    await this.realm.login(this.args.realmURL);
    await this.realm.ensureRealmMeta(this.args.realmURL);
  });

  @cached
  private get realmInfo() {
    return this.realm.info(this.args.realmURL);
  }

  private get name() {
    return this.realmInfo.name;
  }

  get tileMenuItems() {
    return [
      new MenuItem({
        label: this.isFavorited ? 'Unfavorite' : 'Favorite',
        icon: this.isFavorited ? StarFilled : Star,
        action: this.toggleFavorite,
      }),
      new MenuItem({
        label: 'Delete Workspace',
        icon: IconTrash,
        action: this.openDeleteModal,
        dangerous: true,
        disabled: !this.canDeleteWorkspace,
      }),
    ];
  }

  @action async toggleFavorite() {
    if (this.isFavorited) {
      await this.matrixService.removeWorkspaceFavorite(this.args.realmURL);
    } else {
      await this.matrixService.addWorkspaceFavorite(this.args.realmURL);
    }
  }

  private get primaryPublishedURL() {
    return this.publishedRealmURLs[0] ?? '';
  }

  private get displayPublishedURL() {
    try {
      let url = new URL(this.primaryPublishedURL);
      return url.host + url.pathname.replace(/\/$/, '');
    } catch {
      return this.primaryPublishedURL;
    }
  }

  @action toggleHostDropdown(event: MouseEvent) {
    event.stopPropagation();
    if (!this.hasPublishedRealms) return;
    this.isHostDropdownOpen = !this.isHostDropdownOpen;
  }

  @action openPublishedRealm(url: string, event: MouseEvent) {
    event.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
    this.isHostDropdownOpen = false;
  }

  @action closeHostDropdown() {
    this.isHostDropdownOpen = false;
  }

  private get backgroundURL() {
    return this.realmInfo.backgroundURL;
  }

  private get backgroundImageURL() {
    return this.backgroundURL ? `url(${this.backgroundURL})` : '';
  }

  private get visibility() {
    return this.realmInfo.visibility;
  }

  private get visibilityIcon() {
    switch (this.visibility) {
      case 'public':
        return IconGlobe;
      case 'shared':
        return Group;
      case 'private':
        return Lock;
      default:
        throw new Error('unknown realm visibility');
    }
  }

  private get workspaceToDelete() {
    return {
      id: this.args.realmURL,
      name: this.name,
    };
  }

  private get canDeleteWorkspace() {
    return this.realm.isRealmOwner(this.args.realmURL);
  }

  private get deleteSummaryText() {
    if (!this.deleteSummary) {
      return null;
    }
    let { cards, definitions, files } = this.deleteSummary;
    return formatWorkspaceDeleteSummary([
      { label: 'card', count: cards },
      { label: 'definition', count: definitions },
      { label: 'file', count: files },
    ]);
  }

  private get publishedRealmURLs() {
    let { lastPublishedAt } = this.realmInfo;
    if (!lastPublishedAt || typeof lastPublishedAt !== 'object') {
      return [];
    }

    return Object.entries(lastPublishedAt)
      .sort(([, leftPublishedAt], [, rightPublishedAt]) => {
        return Number(rightPublishedAt) - Number(leftPublishedAt);
      })
      .map(([publishedRealmURL]) => publishedRealmURL);
  }

  private get hasPublishedRealms() {
    return this.publishedRealmURLs.length > 0;
  }

  @action async openWorkspace() {
    await this.operatorModeStateService.openWorkspace(this.args.realmURL);
  }

  @action openDeleteModal() {
    if (!this.canDeleteWorkspace) {
      return;
    }
    this.deleteSummary = undefined;
    this.deleteError = undefined;
    this.showDeleteModal = true;
    this.loadDeleteSummaryTask.perform();
  }

  @action closeDeleteModal() {
    if (this.deleteWorkspaceTask.isRunning) {
      return;
    }
    this.showDeleteModal = false;
    this.deleteError = undefined;
  }

  @action confirmDeleteWorkspace() {
    this.deleteWorkspaceTask.perform();
  }

  private loadDeleteSummaryTask = dropTask(async () => {
    try {
      let response = await this.network.authedFetch(
        `${this.args.realmURL}_mtimes`,
        {
          headers: {
            Accept: SupportedMimeType.Mtimes,
          },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch workspace contents: ${response.status}`,
        );
      }
      let json = (await response.json()) as {
        data: {
          attributes: {
            mtimes: Record<string, number>;
          };
        };
      };
      this.deleteSummary = summarizeWorkspaceContents(
        Object.keys(json.data.attributes.mtimes),
      );
    } catch (error) {
      console.error(error);
      this.deleteSummary = undefined;
    }
  });

  private deleteWorkspaceTask = dropTask(async () => {
    this.deleteError = undefined;

    try {
      let isActiveWorkspace =
        this.operatorModeStateService.realmURL === this.args.realmURL ||
        this.operatorModeStateService
          .getOpenCardIds()
          .some((cardId) => cardId.startsWith(this.args.realmURL)) ||
        this.operatorModeStateService.codePathString?.startsWith(
          this.args.realmURL,
        );

      await this.realmServer.deleteRealm(this.args.realmURL);
      await this.matrixService.removeRealmFromAccountData(this.args.realmURL);
      this.recentFilesService.removeRecentFilesForRealmURL(this.args.realmURL);
      for (let publishedRealmURL of this.publishedRealmURLs) {
        this.recentFilesService.removeRecentFilesForRealmURL(publishedRealmURL);
      }
      this.realm.removeRealm(this.args.realmURL);

      if (isActiveWorkspace) {
        this.operatorModeStateService.clearStacks();
        await this.operatorModeStateService.updateCodePath(null);
        this.operatorModeStateService.openWorkspaceChooser();
      }

      this.showDeleteModal = false;
    } catch (error: any) {
      this.deleteError = error.message;
    }
  });
}

interface WorkspaceDeleteSummary {
  cards: number;
  definitions: number;
  files: number;
}

function summarizeWorkspaceContents(
  fileURLs: string[],
): WorkspaceDeleteSummary {
  return fileURLs.reduce(
    (summary, fileURL) => {
      let path = new URL(fileURL).pathname;
      if (path.endsWith('/.realm.json')) {
        return summary;
      }
      if (path.endsWith('.json')) {
        summary.cards++;
      } else if (hasExecutableExtension(path)) {
        summary.definitions++;
      } else {
        summary.files++;
      }
      return summary;
    },
    {
      cards: 0,
      definitions: 0,
      files: 0,
    } as WorkspaceDeleteSummary,
  );
}

export function formatWorkspaceDeleteSummary(
  counts: { label: string; count: number }[],
): string {
  let nonZeroCounts = counts
    .filter(({ count }) => count > 0)
    .map(({ label, count }) => `${count} ${pluralize(label, count)}`);

  if (nonZeroCounts.length === 0) {
    return 'no cards, definitions, or files';
  }

  return joinWithAnd(nonZeroCounts);
}

export function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? '';
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

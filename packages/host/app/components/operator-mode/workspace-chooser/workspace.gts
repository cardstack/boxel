import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { tracked } from '@glimmer/tracking';

import { dropTask, task } from 'ember-concurrency';
import pluralize from 'pluralize';

import {
  BoxelDropdown,
  ContextButton,
  Menu,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { cssVar, menuItem } from '@cardstack/boxel-ui/helpers';
import { Group, IconGlobe, IconTrash, Lock } from '@cardstack/boxel-ui/icons';

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
      <div class='workspace-card'>
        <ItemContainer
          class='workspace-card__button'
          data-test-workspace={{this.name}}
          {{on 'click' this.openWorkspace}}
        >
          <div
            class='icon'
            style={{cssVar
              workspace-background-image-url=this.backgroundImageURL
            }}
          >
            <RealmIcon
              class='workspace-realm-icon'
              @realmInfo={{this.realmInfo}}
            />
            <div class='visibility-icon'>
              <this.visibilityIcon width='100%' height='100%' />
            </div>
          </div>
          <div class='info'>
            <span class='name' data-test-workspace-name>{{this.name}}</span>
            <span
              class='visibility'
              data-test-workspace-visibility
            >{{this.visibility}}</span>
          </div>
        </ItemContainer>

        {{#if @showMenu}}
          <div class='workspace-menu'>
            <BoxelDropdown @contentClass='workspace-menu__content'>
              <:trigger as |bindings|>
                <ContextButton
                  class='workspace-menu__trigger'
                  data-test-workspace-menu-trigger={{@realmURL}}
                  @icon='context-menu'
                  @label='Workspace options'
                  @size='small'
                  @variant='ghost'
                  @width='24px'
                  @height='24px'
                  {{bindings}}
                />
              </:trigger>
              <:content as |dd|>
                <Menu
                  class='workspace-menu__list'
                  @closeMenu={{dd.close}}
                  @items={{array
                    (menuItem
                      'Delete workspace'
                      this.openDeleteModal
                      dangerous=true
                      disabled=this.deleteWorkspaceDisabled
                      icon=IconTrash
                    )
                  }}
                />
              </:content>
            </BoxelDropdown>
          </div>
        {{/if}}
      </div>
      {{#if this.showDeleteModal}}
        <DeleteModal
          @itemToDelete={{this.workspaceToDelete}}
          @onCancel={{this.closeDeleteModal}}
          @onConfirm={{this.confirmDeleteWorkspace}}
          @isDeleteRunning={{this.deleteWorkspaceTask.isRunning}}
          @error={{this.deleteError}}
          @size='small'
        >
          <:content>
            <div class='workspace-delete-copy'>
              <header class='workspace-delete-header'>
                <p class='workspace-delete-eyebrow'>Delete workspace</p>
                <p class='workspace-delete-title'>{{this.name}}</p>
              </header>

              {{#if this.loadDeleteSummaryTask.isRunning}}
                <p class='workspace-delete-summary-card'>
                  Checking what will be removed from this workspace...
                </p>
              {{else if this.deleteSummaryText}}
                <p class='workspace-delete-summary-card'>
                  Contains
                  {{this.deleteSummaryText}}.
                </p>
              {{/if}}

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
        position: relative;
      }
      .workspace-card__button {
        display: flex;
      }
      .icon {
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;

        position: relative;
        height: 142px;
        width: 100%;

        display: flex;
        justify-content: center;
        align-items: center;
      }
      .workspace-realm-icon {
        --boxel-realm-icon-size: var(--boxel-icon-xl);
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xl) - 1px
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
        box-shadow: inset 0 0 0 2px rgba(0 0 0 / 15%);
      }
      .visibility-icon {
        position: absolute;
        top: var(--boxel-sp-xs);
        left: var(--boxel-sp-xs);
        width: 20px;
        height: 20px;
        padding: var(--boxel-sp-5xs);
        background: var(--boxel-dark);
        border-radius: 5px;

        --icon-color: var(--boxel-light);
      }
      .info {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background-color: var(--boxel-dark);
        flex: 1;
        width: 100%;
        padding: var(--boxel-sp-xs);
      }
      .info > span {
        text-overflow: ellipsis;
        overflow: hidden;
        width: 100%;
        text-wrap: nowrap;
        text-align: center;
      }
      .name {
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);
      }
      .visibility {
        color: var(--boxel-400);
        font: 500 var(--boxel-font-xs);
        text-transform: capitalize;
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
        gap: var(--boxel-sp);
        max-width: 31rem;
        margin: 0 auto;
        text-align: left;
      }
      .workspace-delete-copy p {
        margin: 0;
      }
      .workspace-delete-header {
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 1px solid rgb(0 0 0 / 10%);
      }
      .workspace-delete-eyebrow {
        color: var(--boxel-danger);
        font: 700 var(--boxel-font-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .workspace-delete-title {
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-lg);
      }
      .workspace-delete-summary-card {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        color: var(--boxel-dark);
        background: rgb(0 0 0 / 4%);
        border: 1px solid rgb(0 0 0 / 8%);
        border-radius: 0.75rem;
        font: 600 var(--boxel-font-sm);
      }
      .workspace-delete-danger-panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        background: rgb(255 80 80 / 6%);
        border: 1px solid rgb(255 80 80 / 16%);
        border-radius: 0.9rem;
      }
      .workspace-delete-warning {
        color: var(--boxel-700);
        font: 500 var(--boxel-font-sm);
        line-height: 1.4;
      }
      .workspace-delete-warning--strong {
        color: var(--boxel-dark);
        font-weight: 600;
      }
      .workspace-delete-published {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xs);
        background: rgb(255 255 255 / 88%);
        border-radius: 0.7rem;
      }
      .workspace-delete-published-title {
        color: var(--boxel-dark);
        font: 700 var(--boxel-font-xs);
        letter-spacing: 0.02em;
      }
      .workspace-delete-published-list {
        margin: 0;
        padding-left: 1rem;
        text-align: left;
      }
      .workspace-delete-published-list li + li {
        margin-top: var(--boxel-sp-5xs);
      }
      .workspace-delete-published-list a {
        color: var(--boxel-blue);
        font: 500 var(--boxel-font-xs);
        line-height: 1.4;
        word-break: break-all;
        text-decoration-thickness: 1px;
        text-underline-offset: 0.12em;
      }
    </style>
  </template>

  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private showDeleteModal = false;
  @tracked private deleteError: string | undefined;
  @tracked private deleteSummary: WorkspaceDeleteSummary | undefined;

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

  private get createdByCurrentUser() {
    let currentUserName = this.matrixService.userName;
    if (!currentUserName) {
      return false;
    }
    let segments = new URL(this.args.realmURL).pathname
      .split('/')
      .filter(Boolean);
    if (segments.length < 2) {
      return false;
    }
    return segments[segments.length - 2] === currentUserName;
  }

  private get canDeleteWorkspace() {
    return this.createdByCurrentUser && this.realm.canWrite(this.args.realmURL);
  }

  private get deleteWorkspaceDisabled() {
    return !this.canDeleteWorkspace;
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

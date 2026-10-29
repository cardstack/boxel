import { associateDestroyableChild } from '@ember/destroyable';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { getOwner, setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { cached, tracked } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import CopyIcon from '@cardstack/boxel-icons/copy';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import RefreshIcon from '@cardstack/boxel-icons/refresh-cw';
import IconTrash from '@cardstack/boxel-icons/trash-2';

import { format as formatDate } from 'date-fns';
import { didCancel, dropTask, task } from 'ember-concurrency';
import { modifier } from 'ember-modifier';
import pluralize from 'pluralize';

import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { Star, StarFilled } from '@cardstack/boxel-ui/icons';

import {
  ensureTrailingSlash,
  hasExecutableExtension,
  logger,
  RealmPaths,
  resolveRRIReference,
  rri,
  SupportedMimeType,
  type RealmIdentifier,
} from '@cardstack/runtime-common';

import { realmURLDisplayText } from '@cardstack/host/lib/realm-utils';
import { publishedRealmURLsFromInfo } from '@cardstack/host/lib/utils';
import { wallpaperImage } from '@cardstack/host/lib/workspace-list';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type WorkspaceDuplicationService from '@cardstack/host/services/workspace-duplication';

const log = logger('workspace-actions');
const SKILLS_REALM = '@cardstack/skills/';

export const WORKSPACE_TILE_TARGET = '[data-workspace-tile] [data-nav-index]';

// The state and actions of one workspace as the dashboard and the workspace
// chooser show it: its options menu, the delete, archive, duplicate and
// re-index flows with their modals, and where focus goes once a modal closes.
// Each workspace component makes its own, since the modals and the focus
// they return belong to that one item, and keeps only its markup.
//
// The component's element goes in `captureTile`, the options menu's trigger in
// `captureMenuTrigger`, and `returnFocusTarget` to each modal.
export class WorkspaceActions {
  @service declare private workspaceDuplication: WorkspaceDuplicationService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked showDeleteModal = false;
  @tracked deleteError: string | undefined;
  @tracked private deleteSummary: WorkspaceDeleteSummary | undefined;
  @tracked showArchiveModal = false;
  @tracked archiveError: string | undefined;
  @tracked showDuplicateModal = false;
  @tracked duplicateError: string | undefined;
  private duplicateAbortController: AbortController | undefined;
  @tracked private duplicateProgress:
    | { copied: number; total: number }
    | undefined;
  @tracked reindexError: string | undefined;

  #getRealmIdentifier: () => RealmIdentifier;

  // Destroyed with `parent`, which cancels its tasks.
  constructor(parent: object, getRealmIdentifier: () => RealmIdentifier) {
    let owner = getOwner(parent);
    if (!owner) {
      throw new Error('WorkspaceActions needs a parent with an owner');
    }
    setOwner(this, owner);
    associateDestroyableChild(parent, this);
    this.#getRealmIdentifier = getRealmIdentifier;
    this.loadRealmTask
      .perform()
      .catch((error: unknown) => this.reportRealmLoadFailure(error));
  }

  private get realmIdentifier() {
    return this.#getRealmIdentifier();
  }

  // Fills in the session and the realm metadata the workspace renders from.
  // The workspace shows a spinner until it finishes; both steps answer at once
  // for a realm already logged in and loaded.
  loadRealmTask = task(async () => {
    await this.realm.login(this.realmIdentifier);
    await this.realm.ensureRealmMeta(this.realmIdentifier);
  });

  // Best-effort: on failure the workspace keeps its placeholder name. Caught
  // so an unconsumed task error doesn't fail whichever test is running, and
  // logged with its stack, since a dropped connection's `Failed to fetch`
  // names neither the request nor the caller.
  private reportRealmLoadFailure(error: unknown) {
    if (didCancel(error)) {
      return;
    }
    log.warn(
      `workspace background realm load failed for ${this.realmIdentifier}: ${error}`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private tileElement: HTMLElement | undefined;
  captureTile = modifier((element: HTMLElement) => {
    this.tileElement = element;
  });
  private menuTrigger: HTMLElement | undefined;
  captureMenuTrigger = modifier((element: HTMLElement) => {
    this.menuTrigger = element;
  });

  // Recorded when a modal opens, since a delete or archive removes this
  // workspace before the modal hands focus back. The position is within its
  // own list, and the list's ancestors are kept too, as the list itself goes
  // once empty.
  private focusContext:
    | { list: HTMLElement; ancestors: HTMLElement[]; position: number }
    | undefined;

  private workspaceTargets(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>(WORKSPACE_TILE_TARGET)];
  }

  private rememberFocusContext() {
    let list = this.tileElement?.parentElement;
    if (!list) {
      this.focusContext = undefined;
      return;
    }
    let ancestors: HTMLElement[] = [];
    for (let el = list.parentElement; el; el = el.parentElement) {
      ancestors.push(el);
    }
    this.focusContext = {
      list,
      ancestors,
      position: this.workspaceTargets(list).findIndex((target) =>
        this.tileElement?.contains(target),
      ),
    };
  }

  // Focus goes back to the menu trigger. Once the workspace is gone it goes
  // to the one that took its place in the list, or else the last one left in
  // it, or else the nearest one outside it. New Workspace comes last, so
  // Enter doesn't create a workspace.
  returnFocusTarget = (): HTMLElement | undefined => {
    if (this.menuTrigger?.isConnected) {
      return this.menuTrigger;
    }
    if (!this.focusContext) {
      return undefined;
    }
    let { list, ancestors, position } = this.focusContext;
    if (list.isConnected) {
      let targets = this.workspaceTargets(list);
      let target = targets[position] ?? targets.at(-1);
      if (target) {
        return target;
      }
    }
    for (let ancestor of ancestors) {
      let target = ancestor.isConnected
        ? ancestor.querySelector<HTMLElement>(WORKSPACE_TILE_TARGET)
        : null;
      if (target) {
        return target;
      }
    }
    for (let container of [list, ...ancestors]) {
      let target = container.isConnected
        ? container.querySelector<HTMLElement>('[data-nav-index]')
        : null;
      if (target) {
        return target;
      }
    }
    return undefined;
  };

  @cached
  get realmInfo() {
    return this.realm.info(this.realmIdentifier);
  }

  get name() {
    return this.realmInfo.name;
  }

  get realmURLDescriptionId() {
    return `${guidFor(this)}-realm-url`;
  }

  get realmURLText() {
    return realmURLDisplayText(
      this.network.virtualNetwork,
      this.realmIdentifier,
    );
  }

  get createdAtLabel() {
    let { createdAt } = this.realmInfo;
    return createdAt ? formatRelativeTime(new Date(createdAt)) : undefined;
  }

  get updatedAtLabel() {
    let { updatedAt } = this.realmInfo;
    return updatedAt ? formatUpdatedTime(new Date(updatedAt)) : undefined;
  }

  @action async openWorkspace() {
    await this.operatorModeStateService.openWorkspace(this.realmIdentifier);
  }

  get isFavorited() {
    return this.matrixService.workspaceFavorites.includes(this.realmIdentifier);
  }

  get menuItems() {
    let items = [
      new MenuItem({
        label: this.isFavorited ? 'Unfavorite' : 'Favorite',
        icon: this.isFavorited ? StarFilled : Star,
        action: this.toggleFavorite,
      }),
    ];
    // Only the skills realm duplicates: its contents are all relative
    // references, which a file-by-file copy keeps intact.
    if (this.canDuplicateWorkspace) {
      items.push(
        new MenuItem({
          label: 'Duplicate Workspace',
          icon: CopyIcon,
          action: this.openDuplicateModal,
        }),
      );
    }
    items.push(
      new MenuItem({
        id: 'realm-settings',
        label: 'Realm Settings',
        icon: FileSettingsIcon,
        action: this.openRealmConfig,
      }),
    );
    if (this.isRealmOwner) {
      items.push(
        new MenuItem({
          label: 'Re-index',
          icon: RefreshIcon,
          action: this.reindexWorkspaceTask.perform,
          // The live indexing flag, not the task, which resolves as soon as
          // the server accepts the request.
          disabled: this.realmInfo.isIndexing,
        }),
        new MenuItem({
          label: 'Archive Workspace',
          icon: ArchiveIcon,
          action: this.openArchiveModal,
        }),
      );
    }
    items.push(
      new MenuItem({
        label: 'Delete Workspace',
        icon: IconTrash,
        action: this.openDeleteModal,
        dangerous: true,
        disabled: !this.isRealmOwner,
      }),
    );
    return items;
  }

  @action private openRealmConfig() {
    this.operatorModeStateService.openCardInInteractMode(
      resolveRRIReference('./realm', rri(this.realmIdentifier)),
      'edit',
    );
    this.operatorModeStateService.closeWorkspaceChooser();
  }

  @action async toggleFavorite() {
    if (this.isFavorited) {
      await this.matrixService.removeWorkspaceFavorite(this.realmIdentifier);
    } else {
      await this.matrixService.addWorkspaceFavorite(this.realmIdentifier);
    }
  }

  get publishedRealmURLs() {
    return publishedRealmURLsFromInfo(this.realmInfo);
  }

  get hasPublishedRealms() {
    return this.publishedRealmURLs.length > 0;
  }

  get primaryPublishedURL() {
    return this.publishedRealmURLs[0] ?? '';
  }

  get displayPublishedURL() {
    try {
      let url = new URL(this.primaryPublishedURL);
      return url.host + url.pathname.replace(/\/$/, '');
    } catch {
      return this.primaryPublishedURL;
    }
  }

  @action openPublishedRealm(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  get backgroundImageURL() {
    return wallpaperImage(this.realmInfo.backgroundURL);
  }

  get visibility() {
    return this.realmInfo.visibility;
  }

  get visibilityLabel() {
    switch (this.visibility) {
      case 'public':
        return 'Public workspace';
      case 'shared':
        return 'Shared workspace';
      default:
        return 'Private workspace';
    }
  }

  // Cards / Files / Definitions counts. A stat with no count is dropped
  // rather than shown as 0. The counts are requested for favorites alone,
  // after the workspace renders, so the line that shows them is reserved.
  get tileStats(): { label: string; count: number }[] {
    let counts = this.realm.indexCounts(this.realmIdentifier);
    if (!counts) {
      return [];
    }
    return [
      { label: 'Cards', count: counts.cardCount },
      { label: 'Files', count: counts.fileCount },
      { label: 'Definitions', count: counts.definitionCount },
    ].filter((stat): stat is { label: string; count: number } => !!stat.count);
  }

  private get isRealmOwner() {
    return this.realm.isRealmOwner(this.realmIdentifier);
  }

  private get canDuplicateWorkspace() {
    return (
      this.network.virtualNetwork.unresolveURL(
        ensureTrailingSlash(this.realmIdentifier),
      ) === SKILLS_REALM
    );
  }

  get deleteSummaryText() {
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

  get duplicateProgressLabel() {
    if (!this.duplicateProgress) {
      return 'Preparing to copy…';
    }
    let { copied, total } = this.duplicateProgress;
    return `Copying ${copied} of ${total} ${pluralize('file', total)}…`;
  }

  @action private openDeleteModal() {
    if (!this.isRealmOwner) {
      return;
    }
    this.deleteSummary = undefined;
    this.deleteError = undefined;
    this.rememberFocusContext();
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

  @action private openArchiveModal() {
    if (!this.isRealmOwner) {
      return;
    }
    this.archiveError = undefined;
    this.rememberFocusContext();
    this.showArchiveModal = true;
  }

  @action closeArchiveModal() {
    if (this.archiveWorkspaceTask.isRunning) {
      return;
    }
    this.showArchiveModal = false;
    this.archiveError = undefined;
  }

  @action private openDuplicateModal() {
    if (!this.canDuplicateWorkspace) {
      return;
    }
    this.duplicateError = undefined;
    this.rememberFocusContext();
    this.showDuplicateModal = true;
  }

  @action closeDuplicateModal() {
    if (this.duplicateWorkspaceTask.isRunning) {
      this.cancelDuplication();
      return;
    }
    this.showDuplicateModal = false;
    this.duplicateError = undefined;
  }

  // The modal closes at once; the service notices the abort at its next
  // batch and cleans up the partial realm in the background.
  @action private cancelDuplication() {
    this.duplicateAbortController?.abort();
    this.showDuplicateModal = false;
    this.duplicateProgress = undefined;
  }

  @action clearReindexError() {
    this.reindexError = undefined;
  }

  // Whether the workspace, or anything open from it, is on screen behind the
  // dashboard or the chooser; removing it then clears the stacks. A stack's
  // base card counts as well as its top one: a stack based on the
  // workspace's index card makes it the current realm, and once it has left
  // the available realms the current realm no longer says so.
  private isOnScreen(realmIdentifier: RealmIdentifier) {
    let realmPath = new RealmPaths(
      realmIdentifier,
      this.network.virtualNetwork,
    );
    let { codePath, stacks } = this.operatorModeStateService.state;
    return (
      this.operatorModeStateService.realmURL ===
        this.network.virtualNetwork.toURL(realmIdentifier).href ||
      stacks.some((stack) =>
        [stack[0], stack[stack.length - 1]].some((item) =>
          item?.id ? realmPath.inRealm(rri(item.id)) : false,
        ),
      ) ||
      this.operatorModeStateService
        .getOpenCardIds()
        .some((cardId) => realmPath.inRealm(cardId)) ||
      Boolean(codePath && realmPath.inRealm(codePath))
    );
  }

  private async leaveRemovedWorkspace(wasActive: boolean) {
    if (wasActive) {
      this.operatorModeStateService.clearStacks();
      await this.operatorModeStateService.updateCodePath(null);
      this.operatorModeStateService.openWorkspaceChooser();
    }
  }

  // Plain async methods, not part of the tasks: archiving or deleting drops
  // this workspace from the list before it returns, and the teardown that
  // follows can cancel the task, which would skip everything after it. With
  // the workspace gone from the list the page is usable again, so whether
  // it is still on screen is checked once the removal returns.
  private async archiveAndLeave() {
    let { realmIdentifier } = this;
    await this.realmServer.archiveRealm(realmIdentifier);
    // Archiving seals the realm; its session goes so background requests
    // don't loop on 403. Restoring creates a new one.
    this.realm.removeRealm(realmIdentifier);
    await this.leaveRemovedWorkspace(this.isOnScreen(realmIdentifier));
  }

  archiveWorkspaceTask = dropTask(async () => {
    this.archiveError = undefined;
    try {
      await this.archiveAndLeave();
      this.showArchiveModal = false;
    } catch (error: any) {
      this.archiveError = error.message;
    }
  });

  duplicateWorkspaceTask = dropTask(async () => {
    this.duplicateError = undefined;
    this.duplicateProgress = undefined;
    this.duplicateAbortController = new AbortController();
    try {
      await this.workspaceDuplication.duplicateWorkspace(this.realmIdentifier, {
        onProgress: (copied, total) => {
          this.duplicateProgress = { copied, total };
        },
        signal: this.duplicateAbortController.signal,
      });
      this.showDuplicateModal = false;
    } catch (error: any) {
      // A cancel is the user's own doing; only real failures are shown.
      if (error?.name !== 'AbortError') {
        this.duplicateError = String(error?.message ?? error);
      }
    } finally {
      // Also runs when teardown cancels the task, so the service stops
      // copying rather than carrying on with no UI attached.
      this.duplicateAbortController?.abort();
      this.duplicateProgress = undefined;
      this.duplicateAbortController = undefined;
    }
  });

  reindexWorkspaceTask = dropTask(async () => {
    this.clearReindexError();
    try {
      await this.realm.fullReindex(this.realmIdentifier);
    } catch (error: any) {
      // Stays until dismissed or retried, so a failed pass is noticed.
      this.reindexError = String(error?.message ?? error);
    }
  });

  loadDeleteSummaryTask = dropTask(async () => {
    try {
      let response = await this.network.authedFetch(
        `${this.realmIdentifier}_mtimes`,
        { headers: { Accept: SupportedMimeType.Mtimes } },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch workspace contents: ${response.status}`,
        );
      }
      let json = (await response.json()) as {
        data: { attributes: { mtimes: Record<string, number> } };
      };
      this.deleteSummary = summarizeWorkspaceContents(
        Object.keys(json.data.attributes.mtimes),
      );
    } catch (error) {
      console.error(error);
      this.deleteSummary = undefined;
    }
  });

  private async deleteAndLeave() {
    let { realmIdentifier, publishedRealmURLs } = this;
    await this.realmServer.deleteRealm(realmIdentifier);
    await this.matrixService.removeRealmFromAccountData(realmIdentifier);
    this.recentFilesService.removeRecentFilesForRealmURL(realmIdentifier);
    for (let publishedRealmURL of publishedRealmURLs) {
      this.recentFilesService.removeRecentFilesForRealmURL(publishedRealmURL);
    }
    this.realm.removeRealm(realmIdentifier);
    await this.leaveRemovedWorkspace(this.isOnScreen(realmIdentifier));
  }

  deleteWorkspaceTask = dropTask(async () => {
    this.deleteError = undefined;
    try {
      await this.deleteAndLeave();
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

export function summarizeWorkspaceContents(
  fileURLs: string[],
): WorkspaceDeleteSummary {
  return fileURLs.reduce(
    (summary, fileURL) => {
      let path = new URL(fileURL).pathname;
      if (path.endsWith('/realm.json')) {
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

export function formatRelativeTime(date: Date): string {
  let diffMinutes = Math.floor((Date.now() - date.getTime()) / (60 * 1000));
  if (diffMinutes < 1) {
    return formatDate(date, 'h:mm a');
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }
  let diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hr' : 'hrs'} ago`;
  }
  return formatDate(date, 'EEE, MMM d, yyyy');
}

export function formatUpdatedTime(date: Date): string {
  // Clamp to 0: a clock skewed slightly ahead of the server (or a
  // just-written timestamp racing this render) can otherwise produce a
  // negative diff.
  let diffSeconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000),
  );
  if (diffSeconds === 0) {
    return 'Updated just now';
  }
  if (diffSeconds < 60) {
    return `Updated ${diffSeconds} sec ago`;
  }
  let diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `Updated ${diffMinutes} min ago`;
  }
  let diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours} ${diffHours === 1 ? 'hr' : 'hrs'} ago`;
  }
  let diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `Updated ${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  }
  let diffMonths = Math.floor(diffDays / 30);
  return `Updated ${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
}

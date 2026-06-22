/**
 * Issue scheduler for the issue-driven loop.
 *
 * Owns issue selection, dependency resolution, and state refresh.
 * Uses an IssueStore abstraction for realm I/O so the scheduler
 * is testable with mocks.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type {
  IssueStatus,
  IssuePriority,
  SchedulableIssue,
} from './factory-agent/index.ts';

import {
  addCommentToIssue,
  ensureJsonExtension,
  toRealmRelativePath,
} from './realm-operations.ts';
import { readCard, writeCard } from './workspace-fs.ts';
import { logger } from './logger.ts';

let log = logger('issue-scheduler');

// ---------------------------------------------------------------------------
// IssueStore interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over realm I/O for loading and refreshing issues.
 * Same pattern as IssueRelationshipLoader in factory-context-builder.ts.
 */
export interface IssueStore {
  /** Fetch all issues for the project from the realm. */
  listIssues(): Promise<SchedulableIssue[]>;
  /** Re-read a single issue's current state from the realm. */
  refreshIssue(issueId: string): Promise<SchedulableIssue>;
  /** Update issue fields in the realm (e.g., status, priority). Descriptions are immutable — use addComment instead. */
  updateIssue(
    issueId: string,
    updates: { status?: string; priority?: string },
  ): Promise<void>;
  /** Append a comment to an issue. All post-creation context goes through comments. */
  addComment(
    issueId: string,
    comment: { body: string; author: string },
  ): Promise<void>;
  /** Update a project's status in the realm. */
  updateProjectStatus?(projectStatus: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<IssuePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// IssueScheduler
// ---------------------------------------------------------------------------

export class IssueScheduler {
  private issueStore: IssueStore;
  private issues: SchedulableIssue[] = [];

  constructor(issueStore: IssueStore) {
    this.issueStore = issueStore;
  }

  /** Load (or reload) the full issue list from the store. */
  async loadIssues(): Promise<void> {
    this.issues = await this.issueStore.listIssues();
    log.info(`Loaded ${this.issues.length} issue(s) from store`);
  }

  /**
   * Pick the next unblocked issue to work on.
   *
   * Selection algorithm:
   * 1. Filter to status = ready | in_progress
   * 2. Exclude issues whose blockedBy contains non-completed issues
   * 3. Exclude issues in the `exclude` set (e.g., exhausted after max iterations)
   * 4. Sort: in_progress first, then priority (high > medium > low), then order (asc)
   * 5. Return first match, or undefined if none
   */
  pickNextIssue(exclude?: ReadonlySet<string>): SchedulableIssue | undefined {
    let eligible = this.getUnblockedIssues(exclude);

    if (eligible.length === 0) {
      return undefined;
    }

    eligible.sort((a, b) => {
      // in_progress before ready (resume semantics)
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;

      // Higher priority first (lower PRIORITY_ORDER number)
      let priorityDiff =
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Lower order first
      return a.order - b.order;
    });

    return eligible[0];
  }

  /**
   * Re-read a single issue from the realm and update the internal list.
   * Returns the refreshed issue.
   */
  async refreshIssueState(issue: SchedulableIssue): Promise<SchedulableIssue> {
    let refreshed = await this.issueStore.refreshIssue(issue.id);

    // Update internal list so hasUnblockedIssues() and pickNextIssue() see the change
    let idx = this.issues.findIndex((i) => i.id === issue.id);
    if (idx >= 0) {
      this.issues[idx] = refreshed;
    }

    return refreshed;
  }

  /** True if any backlog or in_progress issue has no non-completed blockers. */
  hasUnblockedIssues(exclude?: ReadonlySet<string>): boolean {
    return this.getUnblockedIssues(exclude).length > 0;
  }

  /** True if the loaded issue list is non-empty (regardless of status). */
  hasAnyIssues(): boolean {
    return this.issues.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getUnblockedIssues(
    exclude?: ReadonlySet<string>,
  ): SchedulableIssue[] {
    let statusMap = new Map<string, IssueStatus>();
    for (let issue of this.issues) {
      statusMap.set(issue.id, issue.status);
    }

    return this.issues.filter((issue) => {
      // Skip explicitly excluded issues (e.g., exhausted after max iterations)
      if (exclude?.has(issue.id)) {
        return false;
      }

      // Only consider backlog or in_progress issues
      if (issue.status !== 'backlog' && issue.status !== 'in_progress') {
        return false;
      }

      // Exclude issues with non-completed blockers
      for (let blockerId of issue.blockedBy) {
        let blockerStatus = statusMap.get(blockerId);
        if (blockerStatus !== 'done') {
          return false;
        }
      }

      return true;
    });
  }
}

// ---------------------------------------------------------------------------
// RealmIssueStore — concrete implementation using BoxelCLIClient
// ---------------------------------------------------------------------------

/**
 * Loads issues from a Boxel realm via the injected BoxelCLIClient.
 */
export interface RealmIssueStoreConfig {
  realmUrl: string;
  /** Absolute module URL for the darkfactory module (e.g. from inferDarkfactoryModuleUrl()). */
  darkfactoryModuleUrl: string;
  client: BoxelCLIClient;
  /**
   * Local workspace directory mirroring the target realm. Issue mutations
   * (updateIssue, updateProjectStatus, addComment) read/patch/write the
   * workspace copy; listIssues / refreshIssue still query the realm index.
   */
  workspaceDir: string;
}

export class RealmIssueStore implements IssueStore {
  private realmUrl: string;
  private issueTrackerModuleUrl: string;
  private client: BoxelCLIClient;
  private workspaceDir: string;

  constructor(config: RealmIssueStoreConfig) {
    this.realmUrl = config.realmUrl;
    // Tracker types (Issue/Project/IssueTracker) are defined in the
    // `issue-tracker` module and re-exported by `darkfactory`. Derive the
    // canonical `issue-tracker` URL from the darkfactory URL by swapping the
    // final path segment, tolerating a trailing slash.
    this.issueTrackerModuleUrl = config.darkfactoryModuleUrl
      .replace(/\/+$/, '')
      .replace(/[^/]+$/, 'issue-tracker');
    this.client = config.client;
    this.workspaceDir = config.workspaceDir;
  }

  async listIssues(): Promise<SchedulableIssue[]> {
    let result = await this.client.search(this.realmUrl, {
      filter: { type: { module: this.issueTrackerModuleUrl, name: 'Issue' } },
    });

    if (!result.ok) {
      log.warn(
        `Failed to list issues from realm (${result.status}): ${result.error}`,
      );
      return [];
    }

    return (result.data ?? []).map(mapCardToSchedulableIssue);
  }

  async refreshIssue(issueId: string): Promise<SchedulableIssue> {
    let result = await this.client.search(this.realmUrl, {
      filter: {
        every: [
          { type: { module: this.issueTrackerModuleUrl, name: 'Issue' } },
          { eq: { id: issueId } },
        ],
      },
    });

    if (!result.ok || !result.data?.length) {
      throw new Error(
        `Failed to refresh issue "${issueId}": ${!result.ok ? result.error : 'not found'}`,
      );
    }

    return mapCardToSchedulableIssue(result.data[0]);
  }

  async updateIssue(
    issueId: string,
    updates: { status?: string; priority?: string },
  ): Promise<void> {
    let filePath = ensureJsonExtension(
      toRealmRelativePath(issueId, this.realmUrl),
    );
    let readResult = await readCard(this.workspaceDir, filePath);
    if (!readResult.ok || !readResult.document) {
      let reason =
        readResult.status === 404
          ? 'issue not found in workspace'
          : (readResult.error ?? 'no document returned');
      throw new Error(
        `Failed to read issue "${issueId}" for update: ${reason}`,
      );
    }

    let doc = readResult.document as unknown as LooseSingleCardDocument;
    let attrs = (doc.data.attributes ?? {}) as Record<string, unknown>;

    if (updates.status != null) {
      attrs.status = updates.status;
    }
    if (updates.priority != null) {
      attrs.priority = updates.priority;
    }
    attrs.updatedAt = new Date().toISOString();

    doc.data.attributes = attrs;

    let writeResult = await writeCard(
      this.workspaceDir,
      filePath,
      JSON.stringify(doc, null, 2),
    );

    if (!writeResult.ok) {
      throw new Error(
        `Failed to write issue "${issueId}": ${writeResult.error}`,
      );
    }

    log.info(`Updated issue "${issueId}": ${JSON.stringify(updates)}`);
  }

  async addComment(
    issueId: string,
    comment: { body: string; author: string },
  ): Promise<void> {
    let result = await addCommentToIssue(
      this.workspaceDir,
      toRealmRelativePath(issueId, this.realmUrl),
      comment,
    );
    if (!result.ok) {
      throw new Error(
        `Failed to add comment to issue "${issueId}": ${result.error}`,
      );
    }
    log.info(`Added comment to issue "${issueId}" by ${comment.author}`);
  }

  async updateProjectStatus(projectStatus: string): Promise<void> {
    // We expect exactly one Project card per target realm. The search index
    // stays on the realm — card mutations happen locally. Match by the
    // canonical `issue-tracker` module (see the constructor).
    let result = await this.client.search(this.realmUrl, {
      filter: {
        type: { module: this.issueTrackerModuleUrl, name: 'Project' },
      },
      sort: [{ by: 'lastModified', direction: 'desc' as const }],
    });

    if (!result.ok || !result.data?.length) {
      log.warn(
        `No project found to update status: ${!result.ok ? result.error : 'no results'}`,
      );
      return;
    }

    let projectId = result.data[0].id as string;
    let relativePath = toRealmRelativePath(projectId, this.realmUrl);
    let filePath = ensureJsonExtension(relativePath);

    let readResult = await readCard(this.workspaceDir, filePath);
    if (!readResult.ok || !readResult.document) {
      log.warn(
        `Failed to read project "${relativePath}" for status update (status ${readResult.status ?? 'N/A'}): ${readResult.error ?? 'no document'}`,
      );
      return;
    }

    let doc = readResult.document as unknown as LooseSingleCardDocument;
    let attrs = (doc.data.attributes ?? {}) as Record<string, unknown>;
    attrs.projectStatus = projectStatus;
    attrs.updatedAt = new Date().toISOString();
    doc.data.attributes = attrs;

    let writeResult = await writeCard(
      this.workspaceDir,
      filePath,
      JSON.stringify(doc, null, 2),
    );

    if (!writeResult.ok) {
      log.warn(`Failed to update project status: ${writeResult.error}`);
      return;
    }

    log.info(`Updated project "${relativePath}" status to "${projectStatus}"`);
  }
}

// ---------------------------------------------------------------------------
// Card data mapping
// ---------------------------------------------------------------------------

/**
 * Extract card IDs from a Boxel linksToMany relationship, resolved
 * against the parent card's URL so the result matches `card.id` from
 * the realm search index.
 *
 * Boxel encodes linksToMany with dotted keys:
 *   "blockedBy.0": { links: { self: "../Issues/abc" } }
 *   "blockedBy.1": { links: { self: "../Issues/def" } }
 *
 * The realm's search index returns each card's `id` as a full URL
 * (`http://.../Issues/abc`). For the loop's blocker check
 * (`getUnblockedIssues`) to find a blocker's status in the
 * `issue.id → status` map, the IDs we put into `blockedBy` must use
 * the same key space — i.e. also be full URLs. Resolving the
 * relative `../Issues/abc` link against the parent card's URL gives
 * us that.
 *
 * `parentCardId` is the full URL from `card.id` of the issue whose
 * relationships we're parsing. Without a valid base we fall back to
 * the link as-is.
 */
function extractLinksToManyIds(
  relationships: Record<string, unknown> | undefined,
  fieldName: string,
  parentCardId: string,
): string[] {
  if (!relationships) {
    return [];
  }

  let ids: string[] = [];
  let prefix = `${fieldName}.`;

  for (let [key, value] of Object.entries(relationships)) {
    if (!key.startsWith(prefix)) continue;

    let rel = value as { links?: { self?: string | null } } | undefined;
    let linkUrl = rel?.links?.self;
    if (typeof linkUrl !== 'string' || linkUrl.length === 0) continue;

    try {
      ids.push(new URL(linkUrl, parentCardId).href);
    } catch {
      // Non-URL parent (e.g. tests using bare ids like "a") — fall
      // back to the link verbatim. Tests in this case pass already-
      // matching ids so the lookup still works.
      ids.push(linkUrl);
    }
  }

  return ids;
}

/**
 * Map a JSON:API card response to a SchedulableIssue.
 * Extracts scheduling fields from the card's attributes, falling back
 * to safe defaults for any missing fields.
 */
function mapCardToSchedulableIssue(
  card: Record<string, unknown>,
): SchedulableIssue {
  let attrs = (card.attributes ?? card) as Record<string, unknown>;
  let id = (card.id ?? attrs.id ?? '') as string;

  // Extract blockedBy IDs from relationship links, resolved against
  // this card's id so the resulting URLs match what other cards'
  // `card.id` looks like in the search results. Without resolution
  // the keys would be relative ("Issues/foo") while `issue.id` is
  // a full URL — getUnblockedIssues would never find the blocker.
  let blockedBy = extractLinksToManyIds(
    card.relationships as Record<string, unknown> | undefined,
    'blockedBy',
    id,
  );

  return {
    id,
    status: (attrs.status as IssueStatus) ?? 'backlog',
    priority: (attrs.priority as IssuePriority) ?? 'medium',
    blockedBy,
    order: (attrs.order as number) ?? 0,
    summary: (attrs.summary as string) ?? undefined,
    issueType: (attrs.issueType as string) ?? undefined,
    description: (attrs.description as string) ?? undefined,
    acceptanceCriteria: (attrs.acceptanceCriteria as string) ?? undefined,
  };
}

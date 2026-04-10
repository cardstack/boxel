/**
 * Issue scheduler for the issue-driven loop.
 *
 * Owns issue selection, dependency resolution, and state refresh.
 * Uses an IssueStore abstraction for realm I/O so the scheduler
 * is testable with mocks.
 */

import type {
  IssueStatus,
  IssuePriority,
  SchedulableIssue,
} from './factory-agent-types';

import {
  searchRealm,
  readFile,
  writeFile,
  type RealmFetchOptions,
} from './realm-operations';
import { logger } from './logger';

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
  /** Update issue fields in the realm (e.g., status, description). */
  updateIssue(
    issueId: string,
    updates: { status?: string; description?: string },
  ): Promise<void>;
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
// RealmIssueStore — concrete implementation using searchRealm()
// ---------------------------------------------------------------------------

/**
 * Loads issues from a Boxel realm using the searchRealm() function
 * from realm-operations.ts.
 */
export interface RealmIssueStoreConfig {
  realmUrl: string;
  /** Absolute module URL for the darkfactory module (e.g. from inferDarkfactoryModuleUrl()). */
  darkfactoryModuleUrl: string;
  options?: RealmFetchOptions;
}

export class RealmIssueStore implements IssueStore {
  private realmUrl: string;
  private darkfactoryModuleUrl: string;
  private options: RealmFetchOptions | undefined;

  constructor(config: RealmIssueStoreConfig) {
    this.realmUrl = config.realmUrl;
    this.darkfactoryModuleUrl = config.darkfactoryModuleUrl;
    this.options = config.options;
  }

  async listIssues(): Promise<SchedulableIssue[]> {
    let result = await searchRealm(
      this.realmUrl,
      {
        filter: {
          type: { module: this.darkfactoryModuleUrl, name: 'Issue' },
        },
      },
      this.options,
    );

    if (!result.ok) {
      log.warn(
        `Failed to list issues from realm (${result.status}): ${result.error}`,
      );
      return [];
    }

    return (result.data ?? []).map(mapCardToSchedulableIssue);
  }

  async refreshIssue(issueId: string): Promise<SchedulableIssue> {
    let result = await searchRealm(
      this.realmUrl,
      {
        filter: {
          type: { module: this.darkfactoryModuleUrl, name: 'Issue' },
          eq: { id: issueId },
        },
      },
      this.options,
    );

    if (!result.ok || !result.data?.length) {
      throw new Error(
        `Failed to refresh issue "${issueId}": ${!result.ok ? result.error : 'not found'}`,
      );
    }

    return mapCardToSchedulableIssue(result.data[0]);
  }

  async updateIssue(
    issueId: string,
    updates: { status?: string; description?: string },
  ): Promise<void> {
    // Read the source JSON file (not the indexed card, which can have
    // stripped relationships during indexing).
    let readResult = await readFile(
      this.realmUrl,
      `${issueId}.json`,
      this.options,
    );
    if (!readResult.ok || !readResult.document) {
      throw new Error(
        `Failed to read issue "${issueId}" for update: ${readResult.error ?? 'no document returned'}`,
      );
    }

    let doc = readResult.document;
    let attrs = (doc.data.attributes ?? {}) as Record<string, unknown>;

    if (updates.status != null) {
      attrs.status = updates.status;
    }
    if (updates.description != null) {
      attrs.description = updates.description;
    }

    doc.data.attributes = attrs;

    let writeResult = await writeFile(
      this.realmUrl,
      `${issueId}.json`,
      JSON.stringify(doc, null, 2),
      this.options,
    );

    if (!writeResult.ok) {
      throw new Error(
        `Failed to write issue "${issueId}": ${writeResult.error}`,
      );
    }

    log.info(`Updated issue "${issueId}": ${JSON.stringify(updates)}`);
  }
}

// ---------------------------------------------------------------------------
// Card data mapping
// ---------------------------------------------------------------------------

/**
 * Extract card IDs from a Boxel linksToMany relationship.
 *
 * Boxel encodes linksToMany with dotted keys:
 *   "blockedBy.0": { links: { self: "../Issues/abc" } }
 *   "blockedBy.1": { links: { self: "../Issues/def" } }
 *
 * The card ID is extracted from the last path segment of the link URL.
 */
function extractLinksToManyIds(
  relationships: Record<string, unknown> | undefined,
  fieldName: string,
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
    if (typeof linkUrl === 'string' && linkUrl.length > 0) {
      // Extract card ID from URL — last path segment
      // e.g. "../Issues/abc" → "Issues/abc", "https://realm/Issues/abc" → "Issues/abc"
      let lastSlash = linkUrl.lastIndexOf('/');
      let secondLastSlash = linkUrl.lastIndexOf('/', lastSlash - 1);
      if (secondLastSlash >= 0) {
        ids.push(linkUrl.slice(secondLastSlash + 1));
      } else {
        ids.push(linkUrl);
      }
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

  // Extract blockedBy IDs from relationship links.
  // Boxel uses dotted keys for linksToMany: "blockedBy.0", "blockedBy.1", etc.
  // Each has { links: { self: "../Issues/some-id" } } where the last path
  // segment is the card ID.
  let blockedBy = extractLinksToManyIds(
    card.relationships as Record<string, unknown> | undefined,
    'blockedBy',
  );

  return {
    id,
    status: (attrs.status as IssueStatus) ?? 'backlog',
    priority: (attrs.priority as IssuePriority) ?? 'medium',
    blockedBy,
    order: (attrs.order as number) ?? 0,
    summary: (attrs.summary as string) ?? undefined,
    issueType: (attrs.issueType as string) ?? undefined,
  };
}

/**
 * Thin helpers over BoxelCLIClient for patterns that are common enough
 * across the factory to be worth centralizing (read-patch-write for
 * comments, sequence-number derivation, and the pull wrapper).
 *
 * Read/search operations go through `client.search` (for realm-index
 * queries); card mutations go through the local workspace and reach the
 * realm via `client.sync` orchestrated by the loop.
 */

import type { BoxelCLIClient, SearchResult } from '@cardstack/boxel-cli/api';
import { delay } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import type { Logger } from './logger.ts';
import { readCard, writeCard } from './workspace-fs.ts';

/**
 * Ensure a card instance path ends with `.json`. The realm API uses
 * `card+source` content negotiation which requires the full file path
 * including extension.
 */
export function ensureJsonExtension(path: string): string {
  if (!path.endsWith('.json')) {
    return `${path}.json`;
  }
  return path;
}

/**
 * Strip a realm URL prefix from an id. Search-index results return
 * `card.id` as a full URL (`http://.../Issues/foo`), but workspace-fs
 * primitives expect a realm-relative path (`Issues/foo`). Pass the id
 * through this helper at the boundary before treating it as a path.
 */
export function toRealmRelativePath(id: string, realmUrl: string): string {
  let base = ensureTrailingSlash(realmUrl);
  return id.startsWith(base) ? id.slice(base.length) : id;
}

/** Default delay between empty-result retries in {@link searchUntilNonEmpty}. */
export const SEARCH_RETRY_DELAY_MS = 1000;

/**
 * Run a realm-index search, retrying while the result set is empty.
 *
 * Cards the bootstrap agent creates (the IssueTracker board, the Project)
 * are pushed to the realm with a fire-and-forget sync (no `waitForIndex`),
 * so a search issued moments later can race the indexer and come back empty
 * even though the card exists. A caller that must not treat a transient
 * empty result as final passes `retries > 0` to poll until the card is
 * indexed or the budget is exhausted; the default of 0 is a single search
 * with no behavior change.
 *
 * Returns the first result that is a failure or non-empty, otherwise the
 * last (empty) result once retries run out. `onEmptyRetry` fires before each
 * re-search so the caller can log the wait.
 */
export async function searchUntilNonEmpty<
  T extends { ok: boolean; data?: unknown[] | null },
>(
  doSearch: () => Promise<T>,
  options?: {
    retries?: number;
    retryDelayMs?: number;
    onEmptyRetry?: (attempt: number, retries: number) => void;
  },
): Promise<T> {
  let retries = options?.retries ?? 0;
  let retryDelayMs = options?.retryDelayMs ?? SEARCH_RETRY_DELAY_MS;

  let result = await doSearch();
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (!result.ok || (result.data?.length ?? 0) > 0) {
      return result;
    }
    options?.onEmptyRetry?.(attempt, retries);
    await delay(retryDelayMs);
    result = await doSearch();
  }
  return result;
}

/**
 * Derive the canonical `issue-tracker` module URL from a darkfactory module
 * URL by swapping the final path segment (tolerating a trailing slash).
 *
 * The tracker types (Issue/Project/IssueTracker) are defined in the
 * `issue-tracker` module and re-exported by `darkfactory`; index searches
 * must filter on the canonical `issue-tracker` URL. Shared by
 * `RealmIssueStore` and the post-bootstrap link helpers so the mapping from
 * realm module layout lives in one place.
 */
export function inferIssueTrackerModuleUrl(
  darkfactoryModuleUrl: string,
): string {
  return darkfactoryModuleUrl
    .replace(/\/+$/, '')
    .replace(/[^/]+$/, 'issue-tracker');
}

export interface LinkRelationshipToCardOptions {
  client: BoxelCLIClient;
  realmUrl: string;
  workspaceDir: string;
  /** Workspace-relative file of the card to patch (e.g. `index.json`). */
  cardFile: string;
  /** Relationship key to set on the card (e.g. `board`, `project`). */
  relationshipKey: string;
  /**
   * Human-readable name of the searched card, used in log lines
   * (e.g. `IssueTracker board`, `Project`).
   */
  targetLabel: string;
  /**
   * Build the search query for the target card. Run through
   * {@link searchUntilNonEmpty}, so it may be invoked more than once.
   */
  search: () => Promise<SearchResult>;
  /** Build the relationship `self` link from the found card's id. */
  buildLink: (targetId: string, realmUrl: string) => string;
  /**
   * Choose which result's id to link when the search returns more than one.
   * Receives the truthy ids in result order; defaults to the first (let the
   * search's own `sort` decide). Pure id ordering — return a member of `ids`.
   */
  selectId?: (ids: string[]) => string;
  /** Logger for the calling module. */
  log: Logger;
  /** Retry an empty search this many times. See {@link searchUntilNonEmpty}. */
  searchRetries?: number;
  /** Delay between empty-result retries. Defaults to `SEARCH_RETRY_DELAY_MS`. */
  searchRetryDelayMs?: number;
}

/**
 * Search the realm index for a card and patch a relationship on a workspace
 * card to point at it, once it exists.
 *
 * The target card (the IssueTracker board, the seed issue's Project) is
 * created by the bootstrap agent after the linking card is written, so the
 * link starts empty and gets wired here. Returns `true` when it modified the
 * card so the caller can sync; a no-op (search failed, nothing indexed, no
 * usable id, the linking card missing, or the link already correct) returns
 * `false`.
 */
export async function linkRelationshipToCard(
  options: LinkRelationshipToCardOptions,
): Promise<boolean> {
  let {
    realmUrl,
    workspaceDir,
    cardFile,
    relationshipKey,
    targetLabel,
    search,
    buildLink,
    selectId,
    log,
  } = options;

  let result = await searchUntilNonEmpty(search, {
    retries: options.searchRetries ?? 0,
    retryDelayMs: options.searchRetryDelayMs,
    onEmptyRetry: (attempt, retries) =>
      log.info(
        `No ${targetLabel} indexed yet; retrying search (${attempt}/${retries})`,
      ),
  });

  if (!result.ok) {
    log.warn(
      `Could not search for ${targetLabel} (${result.status}): ${result.error}`,
    );
    return false;
  }

  let ids = (result.data ?? [])
    .map((card) => (card as { id?: string }).id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    log.info(
      `No ${targetLabel} found yet; leaving ${relationshipKey} link unset`,
    );
    return false;
  }
  let targetId = selectId ? selectId(ids) : ids[0];
  if (ids.length > 1) {
    log.warn(`Found ${ids.length} ${targetLabel}(s); linking ${targetId}`);
  }
  let link = buildLink(targetId, realmUrl);

  let read = await readCard(workspaceDir, cardFile);
  if (!read.ok || !read.document) {
    log.warn(
      `Cannot link ${relationshipKey} — ${cardFile} missing from workspace (${read.status ?? read.error})`,
    );
    return false;
  }

  let document = read.document as {
    data: {
      relationships?: Record<string, { links?: { self?: string | null } }>;
    };
  };
  let relationships = (document.data.relationships ??= {});
  if (relationships[relationshipKey]?.links?.self === link) {
    return false;
  }
  relationships[relationshipKey] = { links: { self: link } };

  log.info(`Linking ${cardFile} ${relationshipKey} relationship to ${link}`);
  let writeResult = await writeCard(
    workspaceDir,
    cardFile,
    JSON.stringify(document, null, 2),
  );
  if (!writeResult.ok) {
    throw new Error(
      `Failed to write ${cardFile}: ${writeResult.error ?? 'unknown error'}`,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Issue Comments (read-patch-write)
// ---------------------------------------------------------------------------

/**
 * Append a comment to an issue card using read-patch-write against the
 * local workspace. Issue descriptions are immutable — all post-creation
 * context goes through comments.
 */
export async function addCommentToIssue(
  workspaceDir: string,
  path: string,
  comment: { body: string; author: string; datetime?: string },
): Promise<{ ok: boolean; error?: string }> {
  let filePath = ensureJsonExtension(path);

  let existing = await readCard(workspaceDir, filePath);
  if (!existing.ok || !existing.document) {
    return {
      ok: false,
      error: `Failed to read issue at ${filePath}: ${existing.error ?? 'no document'}`,
    };
  }

  let document = existing.document as unknown as LooseSingleCardDocument;
  let attrs = (document.data?.attributes ?? {}) as Record<string, unknown>;
  let existingComments = Array.isArray(attrs.comments)
    ? (attrs.comments as unknown[])
    : [];

  existingComments.push({
    body: comment.body,
    author: comment.author,
    datetime: comment.datetime ?? new Date().toISOString(),
  });

  attrs.comments = existingComments;
  attrs.updatedAt = new Date().toISOString();
  document.data.attributes = attrs;

  return writeCard(workspaceDir, filePath, JSON.stringify(document, null, 2));
}

// ---------------------------------------------------------------------------
// Validation Artifact Sequence Numbers
// ---------------------------------------------------------------------------

/**
 * Get the next sequence number for a validation artifact by searching
 * existing cards of the given type in the realm. Each slug (issue) gets its
 * own independent sequence starting from 1.
 *
 * Shared by TestValidationStep, LintValidationStep, etc., so that sequence
 * numbering is derived from realm state (survives process restarts).
 */
export async function getNextValidationSequenceNumber(
  client: BoxelCLIClient,
  slug: string,
  prefix: string,
  moduleUrl: string,
  cardName: string,
  targetRealm: string,
): Promise<number> {
  let result = await client.search(targetRealm, {
    filter: {
      on: { module: moduleUrl, name: cardName },
    },
    sort: [{ by: 'sequenceNumber', direction: 'desc' }],
  });

  if (!result.ok || !result.data) {
    return 1;
  }

  let normalizedRealmUrl = ensureTrailingSlash(targetRealm);
  let fullPrefix = `${prefix}${slug}-`;
  let maxSeq = 0;

  for (let card of result.data) {
    let cardId = (card as { id?: string }).id ?? '';
    let relativePath = cardId.startsWith(normalizedRealmUrl)
      ? cardId.slice(normalizedRealmUrl.length)
      : cardId;
    if (relativePath.startsWith(fullPrefix)) {
      let attrs = (card as { attributes?: { sequenceNumber?: number } })
        .attributes;
      let seq = attrs?.sequenceNumber ?? 0;
      if (seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return maxSeq + 1;
}

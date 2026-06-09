/**
 * Thin helpers over BoxelCLIClient for patterns that are common enough
 * across the factory to be worth centralizing (read-patch-write for
 * comments, sequence-number derivation, and the pull wrapper).
 *
 * Read/search operations go through `client.search` (for realm-index
 * queries); card mutations go through the local workspace and reach the
 * realm via `client.sync` orchestrated by the loop.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

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

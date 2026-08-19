/**
 * Concrete IssueRelationshipLoader that reads related cards from the
 * local workspace mirror of the target realm.
 *
 * Traverses an issue's `project` and `relatedKnowledge` relationship
 * links and reads the Project / KnowledgeArticle cards from disk.
 */

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type {
  IssueData,
  KnowledgeArticleData,
  ProjectData,
} from './factory-agent/index.ts';

import type { IssueRelationshipLoader } from './factory-context-builder.ts';

import { toRealmRelativePath } from './realm-operations.ts';
import { readCardById } from './workspace-fs.ts';
import { logger } from './logger.ts';

let log = logger('realm-issue-loader');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealmIssueRelationshipLoaderConfig {
  /**
   * Local workspace directory mirroring the target realm. Relationship
   * cards (Project, KnowledgeArticle) are read from this directory.
   */
  workspaceDir: string;
  /**
   * Target realm URL. Issue ids passed in from the scheduler are full
   * URLs (that's what the search index returns); we strip this prefix
   * before treating the id as a workspace path.
   */
  realmUrl: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class RealmIssueRelationshipLoader implements IssueRelationshipLoader {
  private workspaceDir: string;
  private realmUrl: string;

  constructor(config: RealmIssueRelationshipLoaderConfig) {
    this.workspaceDir = config.workspaceDir;
    this.realmUrl = config.realmUrl;
  }

  /**
   * Load the Project card linked from the issue's `project` relationship.
   * Returns undefined if no project relationship exists (e.g., bootstrap issues).
   *
   * The issue passed in may be a SchedulableIssue (reduced shape without
   * relationships), so we always fetch the full card from the realm first.
   */
  async loadProject(issue: IssueData): Promise<ProjectData | undefined> {
    let fullIssue = await this.fetchFullIssue(issue.id);
    if (!fullIssue) return undefined;

    let projectLink = extractRelationshipLink(fullIssue, 'project');
    if (!projectLink) {
      // Expected for seed issues (bootstrap, analysis, design-foundation),
      // which run before any Project card exists — debug, not info, so it
      // doesn't drip into every normal-level run log.
      log.debug(`Issue "${issue.id}" has no project relationship`);
      return undefined;
    }

    let cardId = resolveRelativeLink(projectLink);
    let result = await readCardById(this.workspaceDir, cardId);

    if (!result.ok || !result.document) {
      log.warn(
        `Could not load project for issue "${issue.id}" (status ${result.status ?? 'N/A'}): ${result.error ?? 'not found'}`,
      );
      return undefined;
    }

    let document = result.document as unknown as LooseSingleCardDocument;
    return {
      id: cardId,
      ...document.data.attributes,
      ...(document.data.relationships
        ? { relationships: document.data.relationships }
        : {}),
      meta: document.data.meta,
    } as ProjectData;
  }

  /**
   * Load KnowledgeArticle cards linked from the issue's `relatedKnowledge` relationship.
   * Returns empty array if no knowledge relationships exist.
   *
   * Fetches the full issue card from the realm to get relationship data.
   */
  async loadKnowledge(issue: IssueData): Promise<KnowledgeArticleData[]> {
    let fullIssue = await this.fetchFullIssue(issue.id);
    if (!fullIssue) return [];

    let knowledgeLinks = extractLinksToManyLinks(fullIssue, 'relatedKnowledge');
    if (knowledgeLinks.length === 0) {
      return [];
    }

    let articles: KnowledgeArticleData[] = [];
    for (let link of knowledgeLinks) {
      let cardId = resolveRelativeLink(link);
      try {
        let result = await readCardById(this.workspaceDir, cardId);
        if (result.ok && result.document) {
          let document = result.document as unknown as LooseSingleCardDocument;
          articles.push({
            id: cardId,
            ...document.data.attributes,
            meta: document.data.meta,
          } as KnowledgeArticleData);
        } else {
          log.warn(
            `Could not load knowledge article "${cardId}" (status ${result.status ?? 'N/A'}): ${result.error ?? 'not found'}`,
          );
        }
      } catch (error) {
        log.warn(
          `Error loading knowledge article "${cardId}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return articles;
  }

  /**
   * Fetch the full issue card from the local workspace to get relationship
   * data. The SchedulableIssue from the scheduler only has scheduling
   * fields — relationships and issueType are not included.
   */
  private async fetchFullIssue(
    issueId: string,
  ): Promise<Record<string, unknown> | undefined> {
    let result = await readCardById(
      this.workspaceDir,
      toRealmRelativePath(issueId, this.realmUrl),
    );
    if (!result.ok || !result.document) {
      log.warn(
        `Could not fetch full issue "${issueId}" (status ${result.status ?? 'N/A'}): ${result.error ?? 'not found'}`,
      );
      return undefined;
    }

    let document = result.document as unknown as LooseSingleCardDocument;
    return {
      id: issueId,
      ...document.data.attributes,
      ...(document.data.relationships
        ? { relationships: document.data.relationships }
        : {}),
      meta: document.data.meta,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a linksTo relationship URL from an issue's relationships.
 * Boxel encodes linksTo as: `{ project: { links: { self: "../Projects/foo" } } }`
 */
function extractRelationshipLink(
  issue: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  let relationships = (issue as Record<string, unknown>).relationships as
    | Record<string, unknown>
    | undefined;
  if (!relationships) return undefined;

  let rel = relationships[fieldName] as
    | { links?: { self?: string | null } }
    | undefined;
  let link = rel?.links?.self;
  return typeof link === 'string' && link.length > 0 ? link : undefined;
}

/**
 * Extract linksToMany relationship URLs from an issue's relationships.
 * Boxel encodes linksToMany with dotted keys:
 *   `relatedKnowledge.0`: { links: { self: "../Knowledge Articles/foo" } }
 *   `relatedKnowledge.1`: { links: { self: "../Knowledge Articles/bar" } }
 */
function extractLinksToManyLinks(
  issue: Record<string, unknown>,
  fieldName: string,
): string[] {
  let relationships = (issue as Record<string, unknown>).relationships as
    | Record<string, unknown>
    | undefined;
  if (!relationships) return [];

  let links: string[] = [];
  let prefix = `${fieldName}.`;

  for (let [key, value] of Object.entries(relationships)) {
    if (!key.startsWith(prefix)) continue;

    let rel = value as { links?: { self?: string | null } } | undefined;
    let link = rel?.links?.self;
    if (typeof link === 'string' && link.length > 0) {
      links.push(link);
    }
  }

  return links;
}

/**
 * Resolve a relative link (e.g., "../Projects/foo") to a realm-relative path.
 * Links are relative to the issue's directory (e.g., "Issues/").
 */
function resolveRelativeLink(link: string): string {
  if (!link.startsWith('../')) {
    // Already a realm-relative path or absolute URL — extract last two segments
    let parts = link.split('/');
    if (parts.length >= 2) {
      return parts.slice(-2).join('/');
    }
    return link;
  }

  // Relative link: strip "../" prefix
  // issueId is like "Issues/bootstrap-seed", link is like "../Projects/foo"
  // Result should be "Projects/foo"
  return link.replace(/^\.\.\//g, '');
}

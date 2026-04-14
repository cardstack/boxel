/**
 * Concrete IssueRelationshipLoader that reads related cards from the realm.
 *
 * Traverses an issue's `project` and `relatedKnowledge` relationship links
 * to load the Project card and KnowledgeArticle cards via readFile().
 */

import type {
  IssueData,
  KnowledgeArticleData,
  ProjectData,
} from './factory-agent';

import type { IssueRelationshipLoader } from './factory-context-builder';

import { logger } from './logger';
import { readFile, type RealmFetchOptions } from './realm-operations';

let log = logger('realm-issue-loader');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealmIssueRelationshipLoaderConfig {
  realmUrl: string;
  options?: RealmFetchOptions;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class RealmIssueRelationshipLoader implements IssueRelationshipLoader {
  private realmUrl: string;
  private options: RealmFetchOptions | undefined;

  constructor(config: RealmIssueRelationshipLoaderConfig) {
    this.realmUrl = config.realmUrl;
    this.options = config.options;
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
      log.info(`Issue "${issue.id}" has no project relationship`);
      return undefined;
    }

    let cardId = resolveRelativeLink(projectLink);
    let result = await readFile(this.realmUrl, cardId, this.options);

    if (!result.ok || !result.document) {
      log.warn(
        `Could not load project for issue "${issue.id}": ${result.error ?? 'not found'}`,
      );
      return undefined;
    }

    return {
      id: cardId,
      ...result.document.data.attributes,
      ...(result.document.data.relationships
        ? { relationships: result.document.data.relationships }
        : {}),
      meta: result.document.data.meta,
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
        let result = await readFile(this.realmUrl, cardId, this.options);
        if (result.ok && result.document) {
          articles.push({
            id: cardId,
            ...result.document.data.attributes,
            meta: result.document.data.meta,
          } as KnowledgeArticleData);
        } else {
          log.warn(
            `Could not load knowledge article "${cardId}": ${result.error ?? 'not found'}`,
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
   * Fetch the full issue card from the realm to get relationship data.
   * The SchedulableIssue from the scheduler only has scheduling fields —
   * relationships and issueType are not included.
   */
  private async fetchFullIssue(
    issueId: string,
  ): Promise<Record<string, unknown> | undefined> {
    let result = await readFile(this.realmUrl, issueId, this.options);
    if (!result.ok || !result.document) {
      log.warn(
        `Could not fetch full issue "${issueId}": ${result.error ?? 'not found'}`,
      );
      return undefined;
    }

    return {
      id: issueId,
      ...result.document.data.attributes,
      ...(result.document.data.relationships
        ? { relationships: result.document.data.relationships }
        : {}),
      meta: result.document.data.meta,
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

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

const markdownLinkPattern = /\[([^\]]+)\]\([^)]+\)/g;
const wikiLinkPattern = /\[\[([^[\]]+)\]\]/g;
const markdownHeadingReplacePattern = /^\s*#{1,6}\s+/gm;
const markdownListReplacePattern = /^\s*[-*+]\s+/gm;
const whitespacePattern = /\s+/g;

export interface FactoryBrief {
  title: string;
  sourceUrl: string;
  content: string;
  contentSummary: string;
  tags: string[];
  /**
   * Absolute URL of an existing card the brief asks the factory to
   * adjust. When present, the factory runs the adjust flow (seed the
   * target realm from this card, then apply the brief's adjustments);
   * when absent, the run is greenfield. Read from the brief card's
   * `sourceCardUrl` attribute (see `realm/wiki.gts`).
   */
  sourceCardUrl?: string;
  /**
   * Set when `--brief-url` pointed at a GitHub repository instead of a
   * Boxel brief card (v3 port flow). The brief is synthesized from the
   * repo's metadata + README, and the seed step adds a PORT-ANALYSIS
   * issue ahead of bootstrap: a research turn that pulls the repo's
   * README, screenshots, and demo media, reads them, and writes the
   * "port background" Knowledge Article (feature inventory, screen
   * catalogue, data model, better-than-the-original rubric) that
   * bootstrap then plans the card family from.
   */
  githubRepoUrl?: string;
}

interface BoxelBriefCardInfo {
  name?: string | null;
  summary?: string | null;
}

interface FactoryBriefCardAttributes {
  title?: string | null;
  name?: string | null;
  content?: string | null;
  summary?: string | null;
  description?: string | null;
  tags?: Array<string | null> | null;
  sourceCardUrl?: string | null;
  cardInfo?: BoxelBriefCardInfo | null;
}

interface FactoryBriefLoadOptions {
  /** Boxel CLI client — used to apply per-realm auth to the brief fetch. */
  client?: BoxelCLIClient;
  /** Override fetch (testing). Bypasses client when set. */
  fetch?: typeof globalThis.fetch;
}

export class FactoryBriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactoryBriefError';
  }
}

/**
 * Parse a GitHub repository URL (`https://github.com/<owner>/<repo>[/...]`).
 * Returns undefined for anything else — including GitHub URLs that aren't
 * repo roots we can analyze (gists keep their own flow via a normal brief).
 */
export function parseGitHubRepoUrl(
  sourceUrl: string,
): { owner: string; repo: string } | undefined {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return undefined;
  }
  let [owner, repo] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo) {
    return undefined;
  }
  return { owner, repo: repo.replace(/\.git$/, '') };
}

/** Keep synthesized briefs bounded — a monster README isn't a better brief. */
const GITHUB_README_MAX_CHARS = 30_000;

/**
 * Synthesize a FactoryBrief from a GitHub repository: repo metadata (name,
 * description) via the GitHub API plus the README raw content. Anonymous
 * fetches — public repos only; a private repo surfaces as a brief error.
 */
export async function loadGitHubBrief(
  sourceUrl: string,
  options?: FactoryBriefLoadOptions,
): Promise<FactoryBrief> {
  let parsed = parseGitHubRepoUrl(sourceUrl);
  if (!parsed) {
    throw new FactoryBriefError(`Not a GitHub repository URL: ${sourceUrl}`);
  }
  let { owner, repo } = parsed;
  let fetchFn = options?.fetch ?? globalThis.fetch;
  let repoUrl = `https://github.com/${owner}/${repo}`;

  let description: string | undefined;
  let repoName = repo;
  try {
    let metaResponse = await fetchFn(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: { accept: 'application/vnd.github+json' } },
    );
    if (metaResponse.ok) {
      let meta = (await metaResponse.json()) as {
        name?: string;
        description?: string | null;
      };
      if (meta.name) repoName = meta.name;
      if (meta.description) description = meta.description;
    }
  } catch {
    // Metadata is best-effort; the README and the analysis issue carry the run.
  }

  let readme = '';
  try {
    let readmeResponse = await fetchFn(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: { accept: 'application/vnd.github.raw+json' } },
    );
    if (readmeResponse.ok) {
      readme = (await readmeResponse.text()).slice(0, GITHUB_README_MAX_CHARS);
    }
  } catch {
    // A repo with no reachable README still ports — the analysis issue digs.
  }

  let title = repoName
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');
  let contentSummary =
    description ?? `Port of the ${repoUrl} application to Boxel.`;
  let content = [
    `# Port ${title} to Boxel`,
    '',
    `Source repository: ${repoUrl}`,
    description ? `\n${description}\n` : '',
    '## Repository README',
    '',
    readme || '(README could not be fetched — the port-analysis issue must recover it.)',
  ].join('\n');

  return {
    title: `Port: ${title}`,
    sourceUrl,
    content,
    contentSummary,
    tags: ['github-port'],
    githubRepoUrl: repoUrl,
  };
}

export async function loadFactoryBrief(
  sourceUrl: string,
  options?: FactoryBriefLoadOptions,
): Promise<FactoryBrief> {
  // Briefs are OUR authored content (Boxel wiki cards). A GitHub repo is
  // source material for an inspired-by port — a different input with its
  // own flag. Catch the mix-up here with a pointer instead of a JSON
  // parse error.
  if (parseGitHubRepoUrl(sourceUrl)) {
    throw new FactoryBriefError(
      `${sourceUrl} is a GitHub repository, not a brief card. ` +
        `Use --repo-url for inspired-by ports of a GitHub project.`,
    );
  }

  let headers = { accept: SupportedMimeType.CardSource };
  let response: Response;

  try {
    if (options?.fetch) {
      response = await options.fetch(sourceUrl, { headers });
    } else if (options?.client) {
      // Prefer an authed fetch for private briefs. Fall back to anonymous
      // only when the brief URL isn't in the user's token set (public
      // brief). Other auth failures (Matrix login, token refresh, etc.)
      // rethrow so the real problem surfaces.
      try {
        response = await options.client.authedFetch(sourceUrl, { headers });
      } catch (error) {
        if (isNoRealmTokenError(error)) {
          response = await globalThis.fetch(sourceUrl, { headers });
        } else {
          throw error;
        }
      }
    } else {
      response = await globalThis.fetch(sourceUrl, { headers });
    }
  } catch (error) {
    throw new FactoryBriefError(
      `Failed to fetch brief from ${sourceUrl}: ${formatErrorMessage(error)}`,
    );
  }

  if (!response.ok) {
    throw new FactoryBriefError(
      `Failed to fetch brief from ${sourceUrl}: HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }

  let payload;

  try {
    payload = await response.json();
  } catch (error) {
    throw new FactoryBriefError(
      `Brief response from ${sourceUrl} was not valid JSON: ${formatErrorMessage(error)}`,
    );
  }

  return normalizeFactoryBrief(payload, sourceUrl);
}

export function normalizeFactoryBrief(
  payload: unknown,
  sourceUrl: string,
): FactoryBrief {
  let document = parseBriefDocument(payload);
  let attributes = parseFactoryBriefCardAttributes(document);
  let cardInfo = attributes.cardInfo ?? {};
  let explicitTitle = firstNonEmptyString([
    valueAsTrimmedString(cardInfo.name),
    valueAsTrimmedString(attributes.title),
    valueAsTrimmedString(attributes.name),
  ]);
  let title = explicitTitle ?? inferTitleFromUrl(sourceUrl);
  let summary = firstNonEmptyString([
    valueAsTrimmedString(cardInfo.summary),
    valueAsTrimmedString(attributes.summary),
    valueAsTrimmedString(attributes.description),
  ]);
  let content =
    firstNonEmptyString([
      valueAsTrimmedString(attributes.content),
      valueAsTrimmedString(attributes.description),
      valueAsTrimmedString(attributes.summary),
    ]) ?? '';
  let tags = normalizeTags(attributes.tags);
  let contentSummary = buildContentSummary(summary, content, title);
  let sourceCardUrl = valueAsTrimmedString(attributes.sourceCardUrl);

  return {
    title,
    sourceUrl,
    content,
    contentSummary,
    tags,
    ...(sourceCardUrl ? { sourceCardUrl } : {}),
  };
}

function parseBriefDocument(payload: unknown): LooseSingleCardDocument {
  if (!isObject(payload)) {
    throw new FactoryBriefError('Expected brief card payload to be an object');
  }

  let data = payload.data;

  if (!isObject(data)) {
    throw new FactoryBriefError(
      'Expected brief card payload to include data.attributes',
    );
  }

  let attributes = data.attributes;

  if (!isObject(attributes)) {
    throw new FactoryBriefError(
      'Expected brief card payload to include data.attributes',
    );
  }

  return payload as unknown as LooseSingleCardDocument;
}

function buildContentSummary(
  summary: string | undefined,
  content: string,
  title: string,
): string {
  if (summary) {
    return summary;
  }

  let normalizedContent = collapseWhitespace(stripMarkdown(content));

  if (normalizedContent === '') {
    return `No content summary was available for ${title}.`;
  }

  let firstSentence = normalizedContent.match(/^(.{1,220}?[.!?])(?:\s|$)/);

  if (firstSentence) {
    return firstSentence[1];
  }

  if (normalizedContent.length <= 220) {
    return normalizedContent;
  }

  let truncated = normalizedContent.slice(0, 217);
  let lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace >= 120) {
    truncated = truncated.slice(0, lastSpace);
  }

  return `${truncated}...`;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tag) => valueAsTrimmedString(tag))
    .filter((tag): tag is string => Boolean(tag));
}

function inferTitleFromUrl(sourceUrl: string): string {
  let url = new URL(sourceUrl);
  let segments = url.pathname.split('/').filter(Boolean);
  let slug = segments.at(-1) ?? 'brief';

  return slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');
}

function stripMarkdown(value: string): string {
  return value
    .replace(markdownLinkPattern, '$1')
    .replace(wikiLinkPattern, '$1')
    .replace(markdownHeadingReplacePattern, '')
    .replace(markdownListReplacePattern, '')
    .replace(/[*_`>#]/g, ' ');
}

function firstNonEmptyString(
  values: Array<string | undefined>,
): string | undefined {
  for (let value of values) {
    if (value) {
      return value;
    }
  }

  return undefined;
}

function valueAsTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  let trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

function collapseWhitespace(value: string): string {
  return value.replace(whitespacePattern, ' ').trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseFactoryBriefCardAttributes(
  document: LooseSingleCardDocument,
): FactoryBriefCardAttributes {
  let attributes = document.data.attributes;

  if (!isObject(attributes)) {
    return {};
  }

  return {
    title: parseOptionalString(attributes.title),
    name: parseOptionalString(attributes.name),
    content: parseOptionalString(attributes.content),
    summary: parseOptionalString(attributes.summary),
    description: parseOptionalString(attributes.description),
    tags: parseOptionalStringArray(attributes.tags),
    sourceCardUrl: parseOptionalString(attributes.sourceCardUrl),
    cardInfo: parseBriefCardInfo(attributes.cardInfo),
  };
}

function parseBriefCardInfo(
  value: unknown,
): BoxelBriefCardInfo | null | undefined {
  if (value === null) {
    return null;
  }

  if (!isObject(value)) {
    return undefined;
  }

  return {
    name: parseOptionalString(value.name),
    summary: parseOptionalString(value.summary),
  };
}

function parseOptionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : undefined;
}

function parseOptionalStringArray(
  value: unknown,
): Array<string | null> | null | undefined {
  if (value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => {
    if (item === null) {
      return null;
    }

    return typeof item === 'string' ? item : null;
  });
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Matches `ProfileManager.authedRealmFetch`'s "No realm token available for
 * <url>" error. Scoping the fallback to this specific case keeps Matrix
 * login / token refresh failures visible instead of masking them as
 * anonymous HTTP errors.
 */
function isNoRealmTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /No realm token available/i.test(error.message);
}

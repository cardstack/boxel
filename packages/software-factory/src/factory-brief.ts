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
   * improve. When present, the factory runs the improve flow (seed the
   * target realm from this card, then apply the brief's adjustments);
   * when absent, the run is greenfield. Read from the brief card's
   * `sourceCardUrl` attribute (see `realm/wiki.gts`).
   */
  sourceCardUrl?: string;
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

export async function loadFactoryBrief(
  sourceUrl: string,
  options?: FactoryBriefLoadOptions,
): Promise<FactoryBrief> {
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

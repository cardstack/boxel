import {
  parseRedirectStatusCode,
  validateRedirectTarget,
  validateRoutingPath,
  normalizeRoutingPath,
} from './host-routing-validation.ts';
import { resolveRRIReference } from './url.ts';

// Reads a realm's site settings (`RealmConfig.site`, from realm.json's index
// entry) the way host mode uses them. Only the base contract fields are read,
// so a site realm's RealmConfig subclass can add whatever its editors need.
// Every value is validated on every read (ADR 015 §1.2): an invalid entry is
// dropped and reported in `problems`, the rest are kept, and missing values
// take their defaults. Nothing here compiles an authored string into a
// regular expression (ADR 015 §1.3).

export const MAX_SITE_PAGE_TYPES = 20;
export const MAX_SITE_REDIRECTS = 500;
export const MAX_SITE_HOST_URLS = 20;
export const MAX_SITE_CRAWLERS = 50;

export interface SitePageType {
  // Position in precedence order, from 0.
  index: number;
  name: string;
  // Absolute, with a trailing slash.
  sourceRealm: string;
  cardType: { module: string; name: string };
  // The authored source. href, where and aliases are BXL; the route table
  // compiles them.
  href: string;
  filter?: string;
  where?: string;
  aliases: string[];
  listingPath?: string;
  listingTitle?: string;
  listingSort?: string;
}

export interface SiteRedirect {
  from: string;
  to: string;
  statusCode: 301 | 302;
}

export interface SiteHostURL {
  url: string;
  forward: boolean;
}

export interface SiteSettings {
  tagline?: string;
  language: string;
  themeColor?: string;
  // The canonical address first.
  hostURLs: SiteHostURL[];
  pageTypes: SitePageType[];
  redirects: SiteRedirect[];
  notFound?: string;
  listed: boolean;
  crawlers: { userAgent: string; allow: boolean }[];
  problems: string[];
}

const SEGMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function capped(
  value: unknown,
  max: number,
  what: string,
  problems: string[],
): unknown[] {
  let all = list(value);
  if (all.length > max) {
    problems.push(
      `${what}: only the first ${max} are read; ${all.length - max} dropped`,
    );
  }
  return all.slice(0, max);
}

function httpURL(value: string): URL | undefined {
  try {
    let url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function withSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

function isJSON(value: string, shape: 'object' | 'array'): boolean {
  try {
    let parsed = JSON.parse(value);
    return shape === 'array'
      ? Array.isArray(parsed)
      : Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

// The `:name` segments of a redirect's `from`, or a problem. A name segment
// is a whole path segment: `/old/:slug`, never `/old/x:slug`.
export function redirectSegmentNames(
  from: string,
): { names: string[] } | { problem: string } {
  let names: string[] = [];
  for (let segment of from.split('/').slice(1)) {
    if (segment.startsWith(':')) {
      let name = segment.slice(1);
      if (!SEGMENT_NAME.test(name)) {
        return { problem: `"${segment}" is not a segment name` };
      }
      if (names.includes(name)) {
        return { problem: `":${name}" appears twice` };
      }
      names.push(name);
    } else if (segment.includes(':')) {
      return {
        problem: `"${segment}": a ":" may only start a whole segment`,
      };
    }
  }
  return { names };
}

function readPageType(
  value: unknown,
  index: number,
  realmURL: string,
  problems: string[],
): SitePageType | undefined {
  let t = record(value);
  let label = `page type ${index + 1}`;
  if (!t) {
    problems.push(`${label}: not a page type`);
    return undefined;
  }
  let name = str(t.name) ?? `Page type ${index + 1}`;
  label = `page type "${name}"`;

  let sourceRealm = realmURL;
  let source = str(t.sourceRealm);
  if (source) {
    let url = httpURL(source);
    if (!url) {
      problems.push(`${label}: source realm "${source}" is not an http(s) URL`);
      return undefined;
    }
    sourceRealm = withSlash(url.href);
  }

  let ref = record(t.cardType);
  let module = str(ref?.module);
  let refName = str(ref?.name);
  if (!module || !refName) {
    problems.push(`${label}: no card type`);
    return undefined;
  }
  let cardType = {
    // A relative or realm-prefixed module resolves against the realm that
    // holds realm.json (ADR 002).
    module: resolveRRIReference(module, new URL(realmURL)),
    name: refName,
  };

  let href = str(t.href);
  if (!href) {
    problems.push(`${label}: no href`);
    return undefined;
  }

  let filter = str(t.filter);
  if (filter && !isJSON(filter, 'object')) {
    problems.push(`${label}: filter is not a JSON object`);
    return undefined;
  }

  let listingPath = str(t.listingPath);
  let listingSort = str(t.listingSort);
  if (listingPath) {
    let warning = validateRoutingPath(listingPath);
    if (warning && !warning.startsWith('Trailing slash')) {
      problems.push(`${label}: listing path: ${warning}; no listing`);
      listingPath = undefined;
    } else {
      listingPath = normalizeRoutingPath(listingPath);
    }
  }
  if (listingSort && !isJSON(listingSort, 'array')) {
    problems.push(
      `${label}: listing sort is not a JSON array; listed unsorted`,
    );
    listingSort = undefined;
  }

  return {
    index,
    name,
    sourceRealm,
    cardType,
    href,
    filter,
    where: str(t.where),
    aliases: list(t.aliases)
      .map(str)
      .filter((alias): alias is string => Boolean(alias)),
    listingPath,
    listingTitle: str(t.listingTitle),
    listingSort,
  };
}

function readRedirect(
  value: unknown,
  index: number,
  problems: string[],
): SiteRedirect | undefined {
  let r = record(value);
  let label = `redirect ${index + 1}`;
  let from = str(r?.from);
  let to = str(r?.to);
  if (!from || !to) {
    problems.push(`${label}: needs both from and to`);
    return undefined;
  }
  label = `redirect "${from}"`;
  if (!from.startsWith('/')) {
    problems.push(`${label}: from must start with /`);
    return undefined;
  }
  let segments = redirectSegmentNames(from);
  if ('problem' in segments) {
    problems.push(`${label}: ${segments.problem}`);
    return undefined;
  }
  let targetWarning = validateRedirectTarget(to);
  if (targetWarning) {
    problems.push(`${label}: ${targetWarning}`);
    return undefined;
  }
  let toNames = redirectSegmentNames(new URL(to, 'http://x').pathname);
  if ('names' in toNames) {
    let missing = toNames.names.filter((n) => !segments.names.includes(n));
    if (missing.length) {
      problems.push(
        `${label}: the target uses ${missing
          .map((n) => `:${n}`)
          .join(', ')}, which from does not name`,
      );
      return undefined;
    }
  }
  let statusCode =
    r?.statusCode == null || r.statusCode === ''
      ? 301
      : parseRedirectStatusCode(r.statusCode);
  if (!statusCode) {
    problems.push(`${label}: status code must be 301 or 302`);
    return undefined;
  }
  return { from: normalizeRoutingPath(from), to, statusCode };
}

export function readSiteSettings(
  site: unknown,
  realmURL: string,
): SiteSettings {
  let problems: string[] = [];
  let s = record(site) ?? {};
  realmURL = withSlash(realmURL);

  let hostURLs: SiteHostURL[] = [];
  for (let value of capped(
    s.hostURLs,
    MAX_SITE_HOST_URLS,
    'host URLs',
    problems,
  )) {
    let h = record(value);
    let raw = str(h?.url);
    let url = raw ? httpURL(raw) : undefined;
    if (!url) {
      problems.push(`host URL "${raw ?? ''}" is not an http(s) URL`);
      continue;
    }
    let href = withSlash(url.href);
    if (hostURLs.some((existing) => existing.url === href)) {
      problems.push(`host URL "${href}" is listed twice`);
      continue;
    }
    hostURLs.push({ url: href, forward: h?.forward === true });
  }

  let pageTypes = capped(
    s.pageTypes,
    MAX_SITE_PAGE_TYPES,
    'page types',
    problems,
  )
    .map((value, i) => readPageType(value, i, realmURL, problems))
    .filter((t): t is SitePageType => Boolean(t));

  let redirects = capped(s.redirects, MAX_SITE_REDIRECTS, 'redirects', problems)
    .map((value, i) => readRedirect(value, i, problems))
    .filter((r): r is SiteRedirect => Boolean(r));

  let notFoundId = str(record(s.notFound)?.id);
  let notFound: string | undefined;
  if (notFoundId) {
    let url = httpURL(notFoundId);
    if (url) {
      notFound = url.href;
    } else {
      problems.push(`the not-found card "${notFoundId}" is not a card id`);
    }
  }

  let crawlers = capped(s.crawlers, MAX_SITE_CRAWLERS, 'crawlers', problems)
    .map((value) => {
      let c = record(value);
      let userAgent = str(c?.userAgent);
      if (!userAgent) {
        problems.push('a crawler entry has no user agent');
        return undefined;
      }
      return { userAgent, allow: c?.allow !== false };
    })
    .filter((c): c is { userAgent: string; allow: boolean } => Boolean(c));

  return {
    tagline: str(s.tagline),
    language: str(s.language) ?? 'en',
    themeColor: str(s.themeColor),
    hostURLs,
    pageTypes,
    redirects,
    notFound,
    listed: s.listed !== false,
    crawlers,
    problems,
  };
}

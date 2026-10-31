import {
  parseRedirectStatusCode,
  validateRedirectTarget,
  validateRoutingPath,
  normalizeRoutingPath,
} from './host-routing-validation.ts';
import {
  parsePathTemplate,
  templateVariables,
  type PathTemplate,
} from './site-paths.ts';
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
export const MAX_SITE_CRAWLERS = 50;

export interface SitePageType {
  // Position in precedence order, from 0.
  index: number;
  name: string;
  // Absolute, with a trailing slash.
  sourceRealm: string;
  cardType: { module: string; name: string };
  // The page's address as a path template (`/shop/{handle}`), parsed.
  // Undefined when the authored template is invalid; the problem says why.
  path: string;
  template?: PathTemplate;
  filter?: string;
  // Boxel query sort JSON: which card wins when two share an address's
  // values. Without it the search's own order decides.
  sort?: string;
  // More addresses, as templates, that answer 301 to the card's page.
  aliasTemplates: PathTemplate[];
  listingPath?: string;
  listingTitle?: string;
  listingSort?: string;
  // BXL over the card for its page's og:title, og:description and og:image.
  shareTitle?: string;
  shareDescription?: string;
  shareImage?: string;
}

export interface SiteRedirect {
  from: string;
  to: string;
  statusCode: 301 | 302;
}

export interface SiteSettings {
  tagline?: string;
  language: string;
  themeColor?: string;
  pageTypes: SitePageType[];
  redirects: SiteRedirect[];
  notFound?: string;
  // The card every page is shown inside: the site's header, navigation and
  // footer. Its template places the page with <SitePage />.
  frame?: string;
  listed: boolean;
  crawlers: { userAgent: string; allow: boolean }[];
  // realm.json's `serveSourcePrerender`, which lets a route serve a card
  // another realm holds (ADR 016). Set by Realm.getSiteSettings.
  serveSourcePrerender?: boolean;
  problems: string[];
}

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

  // The index's search doc holds a code ref as `<module>/<name>`; realm.json
  // itself holds `{ module, name }`.
  let module: string | undefined;
  let refName: string | undefined;
  let refString = str(t.cardType);
  if (refString) {
    let slash = refString.lastIndexOf('/');
    module = slash > 0 ? refString.slice(0, slash) : undefined;
    refName = str(refString.slice(slash + 1));
  } else {
    let ref = record(t.cardType);
    module = str(ref?.module);
    refName = str(ref?.name);
  }
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

  let path = str(t.path) ?? '';
  let parsed = path ? parsePathTemplate(path) : { problem: 'no path template' };
  let template: PathTemplate | undefined;
  if ('problem' in parsed) {
    problems.push(`${label}: path: ${parsed.problem}`);
  } else {
    template = parsed;
  }
  let aliasTemplates: PathTemplate[] = [];
  for (let alias of list(t.aliases).map(str)) {
    if (!alias) {
      continue;
    }
    let parsedAlias = parsePathTemplate(alias);
    if ('problem' in parsedAlias) {
      problems.push(`${label}: alias: ${parsedAlias.problem}`);
    } else {
      aliasTemplates.push(parsedAlias);
    }
  }

  let filter = str(t.filter);
  if (filter && !isJSON(filter, 'object')) {
    problems.push(`${label}: filter is not a JSON object`);
    return undefined;
  }

  let sort = str(t.sort);
  if (sort && !isJSON(sort, 'array')) {
    problems.push(
      `${label}: sort is not a JSON array; the search's order decides`,
    );
    sort = undefined;
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
    path,
    template,
    filter,
    sort,
    aliasTemplates,
    listingPath,
    listingTitle: str(t.listingTitle),
    listingSort,
    shareTitle: str(t.shareTitle),
    shareDescription: str(t.shareDescription),
    shareImage: str(t.shareImage),
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
  let fromTemplate = parsePathTemplate(from);
  if ('problem' in fromTemplate) {
    problems.push(`${label}: ${fromTemplate.problem}`);
    return undefined;
  }
  let targetWarning = validateRedirectTarget(to.replace(/[{}]/g, ''));
  if (targetWarning) {
    problems.push(`${label}: ${targetWarning}`);
    return undefined;
  }
  let named = templateVariables(fromTemplate);
  let missing = [...to.matchAll(/\{([A-Za-z0-9_.]+)\}/g)]
    .map((m) => m[1])
    .filter((n) => !named.includes(n));
  if (missing.length) {
    problems.push(
      `${label}: the target uses ${missing
        .map((n) => `{${n}}`)
        .join(', ')}, which from does not name`,
    );
    return undefined;
  }
  let statusCode =
    r?.statusCode == null || r.statusCode === ''
      ? 301
      : parseRedirectStatusCode(r.statusCode);
  if (!statusCode) {
    problems.push(`${label}: status code must be 301 or 302`);
    return undefined;
  }
  return { from: fromTemplate.source, to, statusCode };
}

export function readSiteSettings(
  site: unknown,
  realmURL: string,
): SiteSettings {
  let problems: string[] = [];
  let s = record(site) ?? {};
  realmURL = withSlash(realmURL);

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

  let frameId = str(record(s.frame)?.id);
  let frame: string | undefined;
  if (frameId) {
    let url = httpURL(frameId);
    if (url) {
      frame = url.href;
    } else {
      problems.push(`the frame card "${frameId}" is not a card id`);
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
    pageTypes,
    redirects,
    notFound,
    frame,
    listed: s.listed !== false,
    crawlers,
    problems,
  };
}

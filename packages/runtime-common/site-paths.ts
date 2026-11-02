import { normalizeRoutingPath } from './host-routing-validation.ts';
import type { RouteCard } from './host-routes.ts';
import type {
  SitePageType,
  SiteRedirect,
  SiteSettings,
} from './site-settings.ts';

// A site's addresses as path templates: `/shop/{handle}`,
// `/c/{category.slug}/{slug}`. The syntax is RFC 6570 Level 1 (`{name}`
// simple string expansion), matched the way OpenAPI path templating matches
// a path: an expression fills exactly one whole path segment. A template
// works both ways, so no table of addresses is stored:
//
// - card → path: read each variable from the card and expand it;
// - path → card: match the path's segments, then search for the card whose
//   fields equal the values (`eq`), which the card index answers.
//
// A variable names a field of the card's search doc, or of a linked card
// through a dot (`{category.slug}`). A template
// never transforms a value, since a transform can't be read back; a card
// that needs a derived key computes it as a field. Matching compares
// segments one by one, linear in the path, with no regular expression built
// from the template (ADR site-routing §1.2).

export type PathSegment = { literal: string } | { variable: string };

export interface PathTemplate {
  source: string;
  segments: PathSegment[];
}

// RFC 6570 §2.3 varname, without pct-encoded characters.
const VARNAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
// RFC 3986 pchar, minus the braces a literal can't hold.
const LITERAL = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})+$/;

export function parsePathTemplate(
  source: string,
): PathTemplate | { problem: string } {
  let trimmed = source.trim();
  if (!trimmed.startsWith('/')) {
    return { problem: `"${trimmed}" must start with /` };
  }
  let normalized = normalizeRoutingPath(trimmed);
  let segments: PathSegment[] = [];
  let names = new Set<string>();
  for (let segment of normalized === '/'
    ? []
    : normalized.slice(1).split('/')) {
    if (!segment) {
      return { problem: `"${trimmed}" has an empty segment` };
    }
    if (segment.startsWith('{') && segment.endsWith('}')) {
      let name = segment.slice(1, -1);
      if (/^[+#./;?&]/.test(name)) {
        return {
          problem: `"${segment}": only {name} is allowed; an operator such as + / ? # would let a value span segments or leave the path`,
        };
      }
      if (name.includes(',') || name.includes('*') || name.includes(':')) {
        return {
          problem: `"${segment}": one variable per segment, with no * or :prefix, so the value can be read back`,
        };
      }
      if (!VARNAME.test(name)) {
        return { problem: `"${segment}" is not a variable name` };
      }
      if (names.has(name)) {
        return { problem: `{${name}} appears twice` };
      }
      names.add(name);
      segments.push({ variable: name });
      continue;
    }
    if (segment.includes('{') || segment.includes('}')) {
      return {
        problem: `"${segment}": a variable must fill a whole segment`,
      };
    }
    if (!LITERAL.test(segment)) {
      return { problem: `"${segment}" has a character a path can't hold` };
    }
    segments.push({ literal: segment });
  }
  return { source: normalized, segments };
}

export function templateVariables(template: PathTemplate): string[] {
  return template.segments.flatMap((s) =>
    'variable' in s ? [s.variable] : [],
  );
}

export function isLiteralTemplate(template: PathTemplate): boolean {
  return templateVariables(template).length === 0;
}

// RFC 6570 §3.2.2 simple string expansion: everything but RFC 3986
// unreserved characters is percent-encoded, so a `/` in a value stays in its
// segment.
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() ? value : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

// The path a template gives, from a reader of variable values. Undefined
// when a variable has no usable value: missing, empty, a list or an object.
export function expandPathTemplate(
  template: PathTemplate,
  read: (variable: string) => unknown,
): string | undefined {
  let parts: string[] = [];
  for (let segment of template.segments) {
    if ('literal' in segment) {
      parts.push(segment.literal);
      continue;
    }
    let value = scalar(read(segment.variable));
    if (value === undefined) {
      return undefined;
    }
    parts.push(encodeValue(value));
  }
  return `/${parts.join('/')}`;
}

// The variables a path gives a template, or undefined when its shape
// doesn't fit: a different number of segments, or a literal that differs.
export function matchPathTemplate(
  template: PathTemplate,
  path: string,
): Record<string, string> | undefined {
  let normalized = normalizeRoutingPath(path);
  let parts = normalized === '/' ? [] : normalized.slice(1).split('/');
  if (parts.length !== template.segments.length) {
    return undefined;
  }
  let values: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    let segment = template.segments[i];
    let part = parts[i];
    if ('literal' in segment) {
      if (safeDecode(part) !== safeDecode(segment.literal)) {
        return undefined;
      }
      continue;
    }
    let value = safeDecode(part);
    if (value === undefined || !value) {
      return undefined;
    }
    values[segment.variable] = value.normalize('NFC');
  }
  return values;
}

function safeDecode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

// What a card's variable reads: a field of its search doc, or of a linked
// card through a dot.
export function readCardVariable(card: RouteCard, variable: string): unknown {
  if (variable === 'id') {
    return card.id;
  }
  let [head, ...rest] = variable.split('.');
  let value: unknown = card.attributes[head];
  if (value === undefined && card.linked?.[head]) {
    return rest.length
      ? readCardVariable(card.linked[head], rest.join('.'))
      : card.linked[head].id;
  }
  for (let key of rest) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

// The search a match becomes: the page type's own filter and one `eq` per
// variable. A value that reads as a number matches either spelling, so a
// numeric field matches and a part number like `01234` stays a string. The
// values are data inside `eq`, never operators.
export function pageTypeMatchFilter(
  pageType: Pick<SitePageType, 'filter'>,
  values: Record<string, string>,
): Record<string, unknown> {
  let clauses: Record<string, unknown>[] = [];
  if (pageType.filter) {
    clauses.push(JSON.parse(pageType.filter) as Record<string, unknown>);
  }
  for (let [variable, value] of Object.entries(values)) {
    let asNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
      ? Number(value)
      : undefined;
    clauses.push(
      asNumber !== undefined
        ? {
            any: [
              { eq: { [variable]: value } },
              { eq: { [variable]: asNumber } },
            ],
          }
        : { eq: { [variable]: value } },
    );
  }
  return clauses.length === 1 ? clauses[0] : { every: clauses };
}

// A redirect whose `from` is a template, with `{name}` substitution into
// `to`. Undefined when `from` doesn't match.
export function matchRedirect(
  redirect: SiteRedirect,
  path: string,
): string | undefined {
  let from = parsePathTemplate(redirect.from);
  if ('problem' in from) {
    return undefined;
  }
  let values = matchPathTemplate(from, path);
  if (!values) {
    return undefined;
  }
  return redirect.to.replace(/\{([A-Za-z0-9_.]+)\}/g, (whole, name) =>
    name in values! ? encodeValue(values![name]) : whole,
  );
}

export function isLiteralRedirect(redirect: SiteRedirect): boolean {
  let from = parsePathTemplate(redirect.from);
  return !('problem' in from) && isLiteralTemplate(from);
}

// What a site answers at a path, before the server's own checks: a page, a
// redirect, a listing, or nothing.
export type SiteAnswer =
  | { kind: 'page'; card: RouteCard; pageType: SitePageType }
  | { kind: 'fixed'; card: string; crossRealm?: boolean }
  | { kind: 'redirect'; to: string; status: 301 | 302 }
  | { kind: 'listing'; pageType: SitePageType }
  | { kind: 'none' };

export interface SiteSearch {
  // The cards of a page type whose fields equal the values, as the visitor
  // finds them, at most `limit`, in a stable order.
  matches(
    pageType: SitePageType,
    values: Record<string, string>,
    limit: number,
  ): Promise<RouteCard[]>;
  // Whether a page type's card type and filter take a card.
  routes(pageType: SitePageType, card: RouteCard): Promise<boolean>;
}

// A card's canonical address: the first page type, in declared order, that
// routes it and whose variables it all has. `routes` says whether a page
// type's card type and filter take the card; the caller knows that from the
// search that found it.
export function canonicalPathOf(
  settings: Pick<SiteSettings, 'pageTypes'>,
  card: RouteCard,
  routes: (pageType: SitePageType) => boolean,
): string | undefined {
  for (let pageType of settings.pageTypes) {
    if (!pageType.template || !routes(pageType)) {
      continue;
    }
    let path = expandPathTemplate(pageType.template, (v) =>
      readCardVariable(card, v),
    );
    if (path) {
      return path;
    }
  }
  return undefined;
}

// The canonical address of a card a page type found: an earlier page type
// of the same card type that also routes it wins, as it would for links.
async function canonicalPathFor(
  settings: Pick<SiteSettings, 'pageTypes'>,
  card: RouteCard,
  foundBy: SitePageType,
  search: SiteSearch,
): Promise<string | undefined> {
  let routedBy = new Set<SitePageType>([foundBy]);
  for (let pageType of settings.pageTypes) {
    if (pageType === foundBy) {
      break;
    }
    if (
      pageType.template &&
      pageType.cardType.module === foundBy.cardType.module &&
      pageType.cardType.name === foundBy.cardType.name &&
      (await search.routes(pageType, card))
    ) {
      routedBy.add(pageType);
    }
  }
  return canonicalPathOf(settings, card, (t) => routedBy.has(t));
}

// What a site serves at a realm-relative path, in precedence order:
//
//   1. files and endpoints (left to the caller);
//   2. redirects whose `from` is literal, in declared order (realm.json's
//      routing rules first);
//   3. literal pages: fixed pages (realm.json's routing rules), listing
//      paths, and page types with no variables;
//   4. page type templates, in declared order, falling through when the
//      search finds no card;
//   5. a found card's other addresses (an alias, or a page type after its
//      canonical one) answer 301 to its canonical address;
//   6. redirects whose `from` has variables, in declared order;
//   7. a card's own address, and
//   8. not found (both left to the caller, which knows the realm's cards).
export async function resolveSitePath(
  settings: Pick<SiteSettings, 'pageTypes' | 'redirects'> &
    Partial<Pick<SiteSettings, 'fixedPages'>>,
  path: string,
  search: SiteSearch,
): Promise<SiteAnswer> {
  let normalized = normalizeRoutingPath(path);

  for (let redirect of settings.redirects) {
    if (isLiteralRedirect(redirect)) {
      let to = matchRedirect(redirect, normalized);
      if (to !== undefined) {
        return { kind: 'redirect', to, status: redirect.statusCode };
      }
    }
  }

  for (let fixed of settings.fixedPages ?? []) {
    if (fixed.path === normalized) {
      return {
        kind: 'fixed',
        card: fixed.card,
        ...(fixed.crossRealm ? { crossRealm: true } : {}),
      };
    }
  }

  for (let pageType of settings.pageTypes) {
    if (pageType.listingPath && pageType.listingPath === normalized) {
      return { kind: 'listing', pageType };
    }
  }

  // Literal page types (a fixed page) first, then those with variables.
  let ordered = [
    ...settings.pageTypes.filter(
      (t) => t.template && isLiteralTemplate(t.template),
    ),
    ...settings.pageTypes.filter(
      (t) => !t.template || !isLiteralTemplate(t.template),
    ),
  ];
  for (let pageType of ordered) {
    let templates = [pageType.template, ...pageType.aliasTemplates].filter(
      (t): t is PathTemplate => Boolean(t),
    );
    for (let template of templates) {
      let values = matchPathTemplate(template, normalized);
      if (!values) {
        continue;
      }
      // Two, so a key two cards share is noticed; the first is served.
      let [card] = await search.matches(pageType, values, 2);
      if (!card) {
        continue;
      }
      let canonical = await canonicalPathFor(settings, card, pageType, search);
      if (canonical && canonical !== normalized) {
        return { kind: 'redirect', to: canonical, status: 301 };
      }
      return { kind: 'page', card, pageType };
    }
  }

  for (let redirect of settings.redirects) {
    if (!isLiteralRedirect(redirect)) {
      let to = matchRedirect(redirect, normalized);
      if (to !== undefined) {
        return { kind: 'redirect', to, status: redirect.statusCode };
      }
    }
  }

  return { kind: 'none' };
}

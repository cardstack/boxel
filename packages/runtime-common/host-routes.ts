import { parseBxlAst, prepareBxl, type PreparedBxl } from '@cardstack/bxl';

// The cards a site routes, as its searches return them, and the BXL a page
// type uses for how its pages look when shared. Expressions are checked
// against the `route` profile and run with explicit runtime limits, so one
// reads only its card and its cost is bounded (ADR 015 §1.4).

export interface HostRouteShare {
  title?: string;
  description?: string;
  // An absolute http(s) URL.
  image?: string;
}

export interface RouteCard {
  id: string;
  attributes: Record<string, unknown>;
  // The cards and files the card links to, by field, as absolute URLs. An
  // expression reads one as `.photo.id`, as the card's search doc has it.
  links?: Record<string, string>;
  // The linked cards a search included, by field, so a path template can
  // read `{category.slug}`.
  linked?: Record<string, RouteCard>;
}

function input(card: RouteCard): Record<string, unknown> {
  let linked = Object.fromEntries(
    Object.entries(card.links ?? {}).map(([field, id]) => [field, { id }]),
  );
  return { ...card.attributes, ...linked, id: card.id };
}

const ROUTE_LIMITS = { maxSteps: 10_000, maxOutputs: 1, maxMillis: 50 };

// An href is written either way: jq string interpolation, with or without
// its quotes (`/shop/\(.handle)`), or readable BXL (`"/shop/" & .handle`).
function routeSource(source: string): {
  expression: string;
  readableSyntax: boolean;
} {
  let trimmed = source.trim();
  if (trimmed.includes('\\(')) {
    // Unquoted, the source is the inside of a jq string: wrap it as is, so a
    // hole like `\(.slug | ltrimstr("-"))` keeps its own quotes.
    return {
      expression: trimmed.startsWith('"') ? trimmed : `"${trimmed}"`,
      readableSyntax: false,
    };
  }
  if (trimmed.startsWith('/')) {
    // A literal path, with no expression in it.
    return { expression: JSON.stringify(trimmed), readableSyntax: false };
  }
  return { expression: trimmed, readableSyntax: true };
}

export type CompiledRouteExpression =
  | { ok: true; prepared: PreparedBxl }
  | { ok: false; error: string };

export function compileRouteExpression(
  source: string,
  profile: 'route' | 'predicate' = 'route',
): CompiledRouteExpression {
  let { expression, readableSyntax } =
    profile === 'route'
      ? routeSource(source)
      : { expression: source.trim(), readableSyntax: true };
  try {
    let ast = parseBxlAst(expression, { profile, readableSyntax });
    let errors = ast.profileIssues.filter((i) => i.severity === 'error');
    if (errors.length) {
      return { ok: false, error: errors.map((e) => e.message).join('; ') };
    }
    return {
      ok: true,
      prepared: prepareBxl(expression, {
        readableSyntax,
        runtimeLimits: ROUTE_LIMITS,
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function run(compiled: CompiledRouteExpression, card: RouteCard): unknown {
  if (!compiled.ok) {
    return undefined;
  }
  return compiled.prepared.evaluate(input(card)).value;
}

// How a card's page looks when shared, from its page type's expressions.
// An expression that fails, or gives something unusable, leaves that tag to
// the card's own head.
export function shareFor(
  pageType: {
    shareTitle?: string;
    shareDescription?: string;
    shareImage?: string;
  },
  card: RouteCard,
): HostRouteShare | undefined {
  let text = (source: string | undefined) => {
    if (!source) {
      return undefined;
    }
    let compiled = compileRouteExpression(source);
    try {
      let value = run(compiled, card);
      return typeof value === 'string' && value.trim()
        ? value.trim()
        : typeof value === 'number'
          ? String(value)
          : undefined;
    } catch {
      return undefined;
    }
  };
  let image = text(pageType.shareImage);
  let share: HostRouteShare = {
    title: text(pageType.shareTitle),
    description: text(pageType.shareDescription),
    image: image && /^https?:\/\//.test(image) ? image : undefined,
  };
  return share.title || share.description || share.image ? share : undefined;
}

// What the served page tells the host app about a site's addresses: the
// paths of the cards the page links to, so links and navigation need no
// request, and the listing paths. Anything else the host asks the server.
// Paths are realm-relative; `mount` is where the routing realm sits on the
// host the page was served from.
export interface HostRouteSnapshot {
  // The routing realm's URL.
  realm: string;
  // Its pathname on this host, with a trailing slash: '/sites/owner/shop/'.
  mount: string;
  // [path, card URL] for the page itself and each card it links to, with
  // how the page looks when shared when its page type says.
  pages: ([string, string] | [string, string, HostRouteShare])[];
  // Listing paths, which serve the site's home card.
  listings: string[];
  // The card shown, with status 404, at a path that serves nothing.
  notFound?: string;
}

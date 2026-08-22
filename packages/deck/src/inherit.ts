// `extends` — a decklist that inherits from a published parent.
//
// Part of the browser-safe surface (see `resolve.ts`): no `node:` import
// here, or in anything this file reaches. Walking a chain needs to FETCH
// each parent, which is I/O and therefore lives on the Node side; what is
// here is the pure merge over links somebody else has already loaded. That
// split is deliberate — the flattened map is what ships to a browser, so
// flattening must be a pure function of the chain and nothing else.
//
// Why this exists: remix, the four consumption verbs, and publishing a realm
// are all the same operation — a parent tree plus a small set of overrides —
// and without inheritance each one would grow its own copy of the mechanism.
//
// A remix that changes one module of a two-hundred-module app is this file
// and one entry.

// The child names its parent here: `{ "deck": { "extends": "pub/pkg@1.2.3" } }`.
// Under `deck`, beside `packages` and `dependencies`, because inheritance is
// a Deck concept and the top level of importmap.json is a standard import map.
export const EXTENDS_KEY = 'extends';

// A chain longer than this is a mistake, not a design. The limit exists so a
// cycle or a runaway generator fails with something a person can read
// instead of exhausting memory.
export const EXTENDS_MAX_DEPTH = 8;

// `null` REMOVES an inherited entry.
//
// Absence cannot mean removal — absence is what inheritance is for. So a
// child that wants a parent's entry gone has to say so, and the result is a
// specifier that resolves to nothing: importing it is a load-time error, not
// a silent blank. Failing loudly is the point; a stub would let a removed
// dependency look present until something called it.
export type MapValue = string | null;

export interface InheritableMap {
  imports?: Record<string, MapValue>;
  // A whole scope may be dropped with `null`, or trimmed entry by entry.
  scopes?: Record<string, Record<string, MapValue> | null>;
}

export interface FlatMap {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}

// A parent names an EXACT version, never a tag.
//
// L4 says a published version never changes, which is the only reason
// inheriting from one is safe. A tag moves; a child that inherited through a
// tag would change meaning without anybody editing it, and every remix built
// on it would drift at once.
//
// THE RULE IS EXACTNESS, NOT AN ADDRESS SPACE. This used to accept only
// `pub/pkg@1.2.3`, which is how a depot names its own decks — and that quietly
// made `extends` unusable outside a depot. A Boxel realm names a parent with a
// fully-qualified URL today and will name it with an RRI alias once that
// migration lands, and neither could inherit from anything. The invariant L4
// cares about is that the version cannot move; where the parent lives is the
// host's business.
//
// So all three forms are accepted, and the version is checked in all three:
//
//   acme/blog@1.2.3                              depot-local
//   https://app.example/catalog/acme/blog@1.2.3/ fully qualified
//   @catalog/acme/blog@1.2.3/                    scoped alias
//
// A trailing slash is optional — a realm addresses a deck as a directory and
// writes one; a depot does not.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;
const DEPOT_LOCAL_NAME = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/i;
// `@scope/…` with at least one segment after the scope.
const SCOPED_ALIAS_NAME = /^@[a-z0-9][a-z0-9-]*\/[^/].*$/i;

function isAbsoluteName(name: string): boolean {
  let url;
  try {
    url = new URL(name);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || url.protocol === 'http:';
}

export function isExactParent(spec: string): boolean {
  let candidate = spec.endsWith('/') ? spec.slice(0, -1) : spec;
  // The LAST `@` is the version separator. A leading one belongs to a scope
  // (`@catalog/…`), so an `@` at index 0 means no version was given at all.
  let at = candidate.lastIndexOf('@');
  if (at <= 0) {
    return false;
  }
  let name = candidate.slice(0, at);
  if (!EXACT_VERSION.test(candidate.slice(at + 1))) {
    return false;
  }
  return (
    DEPOT_LOCAL_NAME.test(name) ||
    SCOPED_ALIAS_NAME.test(name) ||
    isAbsoluteName(name)
  );
}

/**
 * Read `deck.extends` from a decklist, if it declares one.
 *
 * Returns undefined for a decklist that does not inherit, and throws for one
 * that inherits from something unusable — a tag, a range, a bare package
 * name. Throwing rather than ignoring is deliberate: a typo'd parent that
 * silently resolved to "no inheritance" would produce an app missing most of
 * its dependencies, reported as unrelated import errors much later.
 */
export function parseExtends(jsonText: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }
  let deck = (parsed as { deck?: Record<string, unknown> })?.deck;
  let value = deck?.[EXTENDS_KEY];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !isExactParent(value)) {
    throw new Error(
      `deck.extends must name an exact version — "acme/blog@1.2.3", ` +
        `"https://app.example/catalog/acme/blog@1.2.3/" or ` +
        `"@catalog/acme/blog@1.2.3/". A tag or a range is refused because ` +
        `it can move, and every deck built on it would drift at once (L4). ` +
        `Got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Flatten an inheritance chain into the single map a browser receives.
 *
 * `chain` is ordered ancestor first, the child that owns the decklist last.
 * Each link overrides the accumulated result.
 *
 * Three rules, applied per link in this order:
 *
 *   1. The link's `imports` override what it inherited; `null` removes.
 *   2. Those overrides REACH INSIDE inherited scopes. A scope entry keyed by
 *      a specifier the link rebinds gets the new target too. Without this a
 *      child could rebind an app's dependency and leave every vendored
 *      package pointing at the old one — two copies of one library in one
 *      document, which is exactly what L7's dedupe corollary forbids. This
 *      matches what `?with=` already does for a trial override; one rule,
 *      not two.
 *   3. The link's OWN `scopes` land last, so declaring a scope explicitly is
 *      the escape hatch from rule 2 — which is how a child keeps a
 *      dependency on a version that differs from its own top-level pin.
 */
/**
 * Read the three inheritance-relevant parts of a decklist.
 *
 * Tolerant of a missing or malformed file in the same way the serve path
 * already is — an unreadable map yields an empty one — but NOT of a
 * malformed `extends`, which throws (see `parseExtends`).
 */
export function parseLink(jsonText: string): DecklistLink {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(jsonText) ?? {};
  } catch {
    return {};
  }
  let link: DecklistLink = {
    imports: (parsed.imports ?? {}) as Record<string, MapValue>,
    scopes: (parsed.scopes ?? {}) as Record<
      string,
      Record<string, MapValue> | null
    >,
  };
  let parent = parseExtends(jsonText);
  if (parent) {
    link.extends = parent;
  }
  return link;
}

export interface DecklistLink extends InheritableMap {
  extends?: string;
}

/**
 * Walk a decklist's ancestry and flatten it.
 *
 * `load` is supplied by the caller because fetching a parent is I/O, and
 * this module has to stay loadable in a browser. A server reads the parent's
 * sealed pack; a host might fetch it over HTTP; a test hands over a literal.
 * The walk itself — ordering, cycles, depth, the merge — is the same
 * everywhere, which is the point of keeping it here.
 *
 * Fails closed (L11). A parent that cannot be loaded throws, naming the
 * spec: an app silently missing the two hundred entries it inherited is a
 * worse outcome than a startup error, and much harder to read.
 */
export async function resolveInheritance(options: {
  start: DecklistLink;
  load: (parent: string) => Promise<DecklistLink | undefined>;
}): Promise<FlatMap> {
  let { start, load } = options;
  let chain: DecklistLink[] = [start];
  let seen = new Set<string>();
  let parent = start.extends;

  while (parent) {
    if (seen.has(parent)) {
      throw new Error(
        `inheritance cycle: ${[...seen, parent].join(' → ')}`,
      );
    }
    seen.add(parent);
    if (chain.length >= EXTENDS_MAX_DEPTH) {
      throw new Error(
        `inheritance chain is deeper than ${EXTENDS_MAX_DEPTH}; last parent was ${parent}`,
      );
    }
    let link = await load(parent);
    if (!link) {
      throw new Error(`extends names a parent that is not available: ${parent}`);
    }
    chain.push(link);
    parent = link.extends;
  }

  // Collected child-first; flattening applies ancestor-first.
  return flattenInheritance(chain.reverse());
}

export function flattenInheritance(chain: readonly InheritableMap[]): FlatMap {
  if (chain.length > EXTENDS_MAX_DEPTH) {
    throw new Error(
      `inheritance chain is ${chain.length} deep; the limit is ${EXTENDS_MAX_DEPTH}`,
    );
  }

  let imports: Record<string, string> = {};
  let scopes: Record<string, Record<string, string>> = {};

  for (let link of chain) {
    let overrides: Record<string, string> = {};
    for (let [specifier, value] of Object.entries(link.imports ?? {})) {
      if (value === null) {
        delete imports[specifier];
        continue;
      }
      imports[specifier] = value;
      overrides[specifier] = value;
    }

    // Rule 2, before the link's own scopes so rule 3 can win.
    if (Object.keys(overrides).length > 0) {
      for (let [prefix, table] of Object.entries(scopes)) {
        scopes[prefix] = Object.fromEntries(
          Object.entries(table).map(([specifier, value]) => [
            specifier,
            overrides[specifier] ?? value,
          ]),
        );
      }
    }

    for (let [prefix, table] of Object.entries(link.scopes ?? {})) {
      if (table === null) {
        delete scopes[prefix];
        continue;
      }
      let merged = { ...(scopes[prefix] ?? {}) };
      for (let [specifier, value] of Object.entries(table)) {
        if (value === null) {
          delete merged[specifier];
        } else {
          merged[specifier] = value;
        }
      }
      scopes[prefix] = merged;
    }
  }

  return { imports, scopes };
}

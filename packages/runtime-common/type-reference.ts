import { InvalidQueryError } from './invalid-query-error.ts';
import { isPrefixForm } from './realm-identifiers.ts';

// How a query names a card type where there is no JavaScript to hand it a
// class: a query-backed field's options, a saved query in card JSON, an HTTP
// body, the AI tool. Two spellings name one type:
//
//   { module: 'https://my.realm/product', name: 'Product' }   the code ref
//   'https://my.realm/product#Product'                         its shorthand
//
// and in either the module may be realm-relative, `$REALM/product`, naming
// the module at that path in the realm the query belongs to: the realm a
// `_search` addresses, the realm of the card declaring a query-backed field or
// a named query, the outer query's realm for a `let` binding or a sort entry's
// comparison set. A search across several realms has no one realm, so a
// realm-relative module is refused there.
//
// Both resolve once, at the boundary where the query's realm is known, to the
// absolute `{ module, name }` (ADR 002: identifiers stay canonical, resolved
// where a request arrives). Everything after — the checks, signatures and
// caches, explain, the engine — reads only that form, so the three spellings
// of one type are one query.

// The token a query writes for its own realm. A query-backed field also takes
// it as a whole value (`realm: '$REALM'`, an `eq` on `'$REALM'`); here it
// roots a module path.
export const REALM_TOKEN = '$REALM';
const REALM_ROOT = `${REALM_TOKEN}/`;

// Where a type reference's `$REALM/` resolves.
export interface TypeReferenceContext {
  // The realm the query belongs to, as a realm identifier (a realm URL or
  // prefix form). Absent, a realm-relative module is left as written for the
  // boundary that knows the realm to resolve.
  realm?: string;
  // Set where `$REALM` names no one realm (a search across several): a
  // realm-relative module is refused with this reason.
  noRealm?: string;
  // Re-spells a resolved URL in its canonical form (prefix form for a mapped
  // realm). A VirtualNetwork's `unresolveURL`.
  canonicalize?: (url: string) => string;
  // Resolves a card id in prefix form to the URL the index keys the card by.
  // A VirtualNetwork's `toURLHref`. Absent, a prefix-form `linkedFrom.card`
  // is left as written (the engine matches it in either form).
  resolveCardId?: (id: string) => string;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function refuse(where: string, message: string): never {
  throw new InvalidQueryError(`${where || '/'}: ${message}`, 'invalid-type');
}

const EXAMPLE =
  'write "<module>#<Name>", such as "https://my.realm/product#Product" or "$REALM/product#Product"';

// A module a shorthand may name: an absolute URL, a prefix-form identifier
// (`@scope/name/…`), or a realm-relative path.
function namesModule(module: string): boolean {
  if (/\s/.test(module)) return false;
  if (/^https?:\/\/[^/]/.test(module)) return true;
  if (isPrefixForm(module)) return /^@[^/]+\/[^/]+/.test(module);
  return module.startsWith(REALM_ROOT) && module.length > REALM_ROOT.length;
}

// `"<module>#<Name>"` as the code ref it stands for. A module never holds a
// `#`, so the name is what follows the last one, and an empty name is
// refused: the convention the CLI reads a card type by (`targetOf` in
// boxel-cli's operations command).
export function parseTypeReference(
  value: string,
  where = '',
): { module: string; name: string } {
  let at = value.lastIndexOf('#');
  if (at < 0) {
    refuse(
      where,
      `"${value.slice(0, 80)}" names no type; ${EXAMPLE}, or { module, name }`,
    );
  }
  let module = value.slice(0, at);
  let name = value.slice(at + 1);
  if (!IDENTIFIER.test(name)) {
    refuse(
      where,
      name === ''
        ? `"${value.slice(0, 80)}" names no type after "#"; ${EXAMPLE}`
        : `"${name.slice(0, 80)}" is not a type's name (an export name such as Product); ${EXAMPLE}`,
    );
  }
  if (!namesModule(module)) {
    refuse(
      where,
      `module "${module.slice(0, 80)}" names no module; write its URL, its @scope/… identifier or $REALM/<path>`,
    );
  }
  return { module, name };
}

function resolveModule(
  module: string,
  where: string,
  ctx: TypeReferenceContext,
): string {
  if (!module.startsWith(REALM_ROOT)) return module;
  let path = module.slice(REALM_ROOT.length);
  if (
    path === '' ||
    path.startsWith('/') ||
    path.split('/').some((s) => s === '..' || s === '.')
  ) {
    refuse(
      where,
      `module "${module.slice(0, 80)}" leaves its realm; $REALM/ is followed by a path inside the realm`,
    );
  }
  if (ctx.noRealm) {
    refuse(
      where,
      `module "${module.slice(0, 80)}" is relative to a realm, and ${ctx.noRealm}; use an absolute or @scope/… module`,
    );
  }
  if (ctx.realm === undefined) return module;
  // Joined here rather than through `codeRefWithAbsoluteIdentifier`: that
  // resolves `$REALM/` only against a prefix-form base (or a mapped realm,
  // through a VirtualNetwork) and keeps the module as written when it cannot,
  // where the realm is known exactly here, in any form.
  let base = ctx.realm.endsWith('/') ? ctx.realm : `${ctx.realm}/`;
  let resolved = `${base}${path}`;
  return ctx.canonicalize && !isPrefixForm(resolved)
    ? ctx.canonicalize(resolved)
    : resolved;
}

const isRecord = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v != null && !Array.isArray(v);

// One type reference: a shorthand parsed, a code ref's realm-relative module
// resolved. Anything else is returned as it is, for the checks to refuse.
function typeRef(
  value: unknown,
  where: string,
  ctx: TypeReferenceContext,
): unknown {
  if (typeof value === 'string') {
    let ref = parseTypeReference(value, where);
    return { ...ref, module: resolveModule(ref.module, where, ctx) };
  }
  if (!isRecord(value)) return value;
  if ('type' in value) {
    // ancestorOf / fieldOf name the type they derive from as `card`
    if (value.card === undefined) return value;
    let card: unknown = typeRef(value.card, `${where}/card`, ctx);
    return card === value.card ? value : { ...value, card };
  }
  if (typeof value.module !== 'string') return value;
  let module = resolveModule(value.module, where, ctx);
  return module === value.module ? value : { ...value, module };
}

// A copy of `node` with `key` replaced, or `node` itself when nothing changed.
function withKey(node: Record<string, any>, key: string, value: unknown) {
  return node[key] === value ? node : { ...node, [key]: value };
}
function mapList(
  list: unknown,
  where: string,
  each: (v: unknown, where: string) => unknown,
) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  let out = list.map((v, i) => {
    let next = each(v, `${where}[${i}]`);
    if (next !== v) changed = true;
    return next;
  });
  return changed ? out : list;
}

// The keys a type sits under: the card grammar's `type` and `on`, and the
// wire's `item.type` and `item.on`.
const TYPE_KEYS = ['type', 'on', 'item.type', 'item.on'];

function filterRefs(
  node: unknown,
  where: string,
  ctx: TypeReferenceContext,
): unknown {
  if (!isRecord(node)) return node;
  let out = node;
  for (let key of TYPE_KEYS) {
    if (key in out) {
      out = withKey(out, key, typeRef(out[key], `${where}/${key}`, ctx));
    }
  }
  for (let key of ['every', 'any']) {
    if (key in out) {
      out = withKey(
        out,
        key,
        mapList(out[key], `${where}/${key}`, (v, w) => filterRefs(v, w, ctx)),
      );
    }
  }
  if ('not' in out) {
    out = withKey(out, 'not', filterRefs(out.not, `${where}/not`, ctx));
  }
  if (isRecord(out.linkedFrom) && typeof out.linkedFrom.card === 'string') {
    let card = cardIdRef(out.linkedFrom.card, `${where}/linkedFrom/card`, ctx);
    if (card !== out.linkedFrom.card) {
      out = withKey(out, 'linkedFrom', { ...out.linkedFrom, card });
    }
  }
  return out;
}

// A card id a filter names (`linkedFrom.card`), in any form a card reference
// takes: an absolute URL, a registered prefix's id (`@scope/name/…`), or
// `$REALM/<path>` in the realm the query belongs to. Resolved once, here: a
// realm-relative id against that realm, and a prefix-form one, where the
// boundary has a network, to the URL the index keys the card by. A form the
// network does not know is left for the checks and the engine (it names no
// card here, so it matches nothing).
function cardIdRef(
  id: string,
  where: string,
  ctx: TypeReferenceContext,
): string {
  let out = id;
  if (id.startsWith(REALM_ROOT)) {
    let path = id.slice(REALM_ROOT.length);
    if (
      path === '' ||
      path.startsWith('/') ||
      path.split('/').some((s) => s === '..' || s === '.')
    ) {
      throw new InvalidQueryError(
        `${where}: "${id.slice(0, 80)}" leaves its realm; $REALM/ is followed by a card's path inside the realm`,
        'invalid-value',
      );
    }
    if (ctx.noRealm) {
      throw new InvalidQueryError(
        `${where}: "${id.slice(0, 80)}" is relative to a realm, and ${ctx.noRealm}; use the card's URL or @scope/… id`,
        'invalid-value',
      );
    }
    if (ctx.realm === undefined) return id;
    let base = ctx.realm.endsWith('/') ? ctx.realm : `${ctx.realm}/`;
    out = `${base}${path}`;
  }
  if (ctx.resolveCardId && isPrefixForm(out)) {
    try {
      return ctx.resolveCardId(out);
    } catch {
      return out;
    }
  }
  return out;
}

function sortRefs(
  entry: unknown,
  where: string,
  ctx: TypeReferenceContext,
): unknown {
  if (!isRecord(entry)) return entry;
  let out = entry;
  for (let key of TYPE_KEYS) {
    if (key in out) {
      out = withKey(out, key, typeRef(out[key], `${where}/${key}`, ctx));
    }
  }
  // a blend's signals, before and after lowering
  for (let key of ['blend', 'of']) {
    if (key in out) {
      out = withKey(
        out,
        key,
        mapList(out[key], `${where}/${key}`, (v, w) => sortRefs(v, w, ctx)),
      );
    }
  }
  // a boost's filter, before and after lowering
  for (let key of ['boost', 'when']) {
    if (key in out) {
      out = withKey(out, key, filterRefs(out[key], `${where}/${key}`, ctx));
    }
  }
  // an expression sort entry's comparison set (`compare.filter`)
  if (isRecord(out.compare) && 'filter' in out.compare) {
    let filter = filterRefs(out.compare.filter, `${where}/compare/filter`, ctx);
    if (filter !== out.compare.filter) {
      out = withKey(out, 'compare', { ...out.compare, filter });
    }
  }
  return out;
}

function queryRefs(
  query: Record<string, any>,
  where: string,
  ctx: TypeReferenceContext,
  depth: number,
): Record<string, any> {
  let out = query;
  // `type` at the top of a query; `on` at the top of a named query's request
  for (let key of ['type', 'on']) {
    if (key in out) {
      out = withKey(out, key, typeRef(out[key], `${where}/${key}`, ctx));
    }
  }
  if ('filter' in out) {
    out = withKey(
      out,
      'filter',
      filterRefs(out.filter, `${where}/filter`, ctx),
    );
  }
  if ('sort' in out) {
    out = withKey(
      out,
      'sort',
      mapList(out.sort, `${where}/sort`, (v, w) => sortRefs(v, w, ctx)),
    );
  }
  if (isRecord(out.collapse)) {
    out = withKey(
      out,
      'collapse',
      filterRefsAt(out.collapse, `${where}/collapse`, ctx),
    );
  }
  if ('facets' in out) {
    out = withKey(
      out,
      'facets',
      mapList(out.facets, `${where}/facets`, (v, w) =>
        isRecord(v) ? filterRefsAt(v, w, ctx) : v,
      ),
    );
  }
  if (isRecord(out.rerank) && isRecord(out.rerank.compare)) {
    let compare = out.rerank.compare;
    if ('filter' in compare) {
      let filter = filterRefs(
        compare.filter,
        `${where}/rerank/compare/filter`,
        ctx,
      );
      if (filter !== compare.filter) {
        out = {
          ...out,
          rerank: { ...out.rerank, compare: { ...compare, filter } },
        };
      }
    }
  }
  // each binding's query belongs to the outer query's realm; a binding
  // cannot nest another, so the walk stops a level down
  if (isRecord(out.let) && depth < 2) {
    let changed = false;
    let bindings: Record<string, any> = {};
    for (let [name, binding] of Object.entries(out.let)) {
      let next = binding;
      if (isRecord(binding) && isRecord(binding.from)) {
        let from = queryRefs(
          binding.from,
          `${where}/let/${name}/from`,
          ctx,
          depth + 1,
        );
        if (from !== binding.from) next = { ...binding, from };
      }
      if (next !== binding) changed = true;
      bindings[name] = next;
    }
    if (changed) out = { ...out, let: bindings };
  }
  return out;
}

// `on` (and the wire's `item.on`) on a node that is not a filter: a collapse,
// a facet.
function filterRefsAt(
  node: Record<string, any>,
  where: string,
  ctx: TypeReferenceContext,
) {
  let out = node;
  for (let key of ['on', 'item.on']) {
    if (key in out) {
      out = withKey(out, key, typeRef(out[key], `${where}/${key}`, ctx));
    }
  }
  return out;
}

// Every type reference in a query — its top-level `type`, every filter's
// `type` and `on`, sort and blend anchors, a collapse's and a facet's `on`, a
// rerank's comparison set and each `let` binding's query — with each
// shorthand parsed and each realm-relative module resolved against
// `ctx.realm`. Reads either grammar, the card query's or the wire's. Returns
// the query itself when it held nothing to rewrite, so a query in the object
// form with absolute modules passes through untouched, as it always has.
// A shorthand that names no type, or a realm-relative module where there is
// no one realm, is refused with `invalid-type`.
export function resolveTypeReferences<Q>(
  query: Q,
  ctx: TypeReferenceContext = {},
): Q {
  if (!isRecord(query)) return query;
  return queryRefs(query, '', ctx, 0) as Q;
}

// The context a search request's realms give its type references: one realm
// is the realm `$REALM` names; several name no one realm.
export function searchTypeReferenceContext(
  realms: string[],
  canonicalize?: (url: string) => string,
): TypeReferenceContext {
  let distinct = [...new Set(realms)];
  if (distinct.length > 1) {
    return {
      noRealm: `this search spans ${distinct.length} realms`,
      ...(canonicalize ? { canonicalize } : {}),
    };
  }
  return {
    ...(distinct.length === 1 ? { realm: distinct[0] } : {}),
    ...(canonicalize ? { canonicalize } : {}),
  };
}

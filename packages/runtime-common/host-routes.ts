// Validation of a realm's host routes: the `hostRoutingRules` tree of its
// realm.json, read raw from the search document, in; the routes the server
// may route on, and a warning for each route it dropped or has doubts
// about, out.
//
// It is a pure function. What it needs from the index, the definitions of
// the card types that field-match routes name, comes in as a lookup the
// caller fills beforehand (see `hostRouteTypeRefs` and `hostRouteTypeInfo`),
// so the server and the host app can run the same validation.
//
// The validated tree keeps the authored order, since order decides
// fall-through among dynamic siblings and which route is a card's canonical
// one, and it keeps each pattern parsed, so nothing downstream parses again.
//
// Top-level fixed card routes and redirects without `:name` segments are
// validated exactly as the routing map always validated them: their path is
// any string, normalized but not parsed, so a realm.json written before
// dynamic routes routes the same way. `hostRoutingMapFromRoutes` turns the
// validated tree back into that map.

import type { CodeRef, ResolvedCodeRef } from './code-ref.ts';
import type { Definition, FieldDefinition } from './definitions.ts';
import type { RawHostRoutingRule } from './realm.ts';
import { assertQuery, type Filter } from './query.ts';
import { isClientEvaluable } from './instance-filter-matcher.ts';
import { RealmPaths } from './paths.ts';
import { rri } from './realm-identifiers.ts';
import {
  DEFAULT_REDIRECT_STATUS,
  findRedirectCycles,
  normalizeRoutingPath,
  parseRedirectStatusCode,
  validateRedirectTarget,
  type HostRoutingRule,
  type RedirectStatusCode,
} from './host-routing-validation.ts';
import {
  parseCardIdPattern,
  parseRoutePathPattern,
  type CardIdPattern,
  type RoutePathPattern,
} from './route-pattern.ts';

// The most dynamic routes a realm may have. Routes after the limit, in
// depth-first authored order, are dropped.
export const MAX_DYNAMIC_HOST_ROUTES = 20;

// What validation needs to know about a card type that a field-match route
// names. Types are compared by key, and the caller spells every key the
// same way (the server uses `internalKeyFor`).
export interface HostRouteTypeInfo {
  // The type's own key.
  key: string;
  // The type's key, then the key of each type it descends from, when the
  // caller knows them; otherwise just the type's key.
  types: readonly string[];
  // Whether the type is a card type (not a field or file type).
  isCardType: boolean;
  // The type's own fields by name. `isPrimitive` is false for a link or a
  // compound field. `target` is the key of the card type a `linksTo` or
  // `linksToMany` field points to.
  fields: Readonly<Record<string, HostRouteTypeField>>;
}

export interface HostRouteTypeField {
  type: FieldDefinition['type'];
  isPrimitive: boolean;
  target?: string;
}

// Builds a `HostRouteTypeInfo` from a type's indexed definition, and its
// adoption chain when the caller has it (a definition entry's `types`).
// `keyFor` spells a code ref as a key, the same way `types` spells them.
// Without `types`, a link counts only when it names the type itself, not a
// type it descends from.
export function hostRouteTypeInfo(
  entry: { definition: Definition; types?: readonly string[] },
  keyFor: (ref: CodeRef) => string,
): HostRouteTypeInfo {
  let { definition } = entry;
  let types = entry.types ?? [];
  let fields: Record<string, HostRouteTypeField> = {};
  for (let [name, defId] of Object.entries(definition.fields)) {
    let fieldDef = definition.fieldDefs[defId];
    if (!fieldDef) {
      continue;
    }
    let target: string | undefined;
    if (fieldDef.type === 'linksTo' || fieldDef.type === 'linksToMany') {
      try {
        target = keyFor(fieldDef.fieldOrCard);
      } catch {
        target = undefined;
      }
    }
    let isPrimitive = fieldDef.isPrimitive;
    fields[name] = target
      ? { type: fieldDef.type, isPrimitive, target }
      : { type: fieldDef.type, isPrimitive };
  }
  let key = types[0] ?? keyFor(definition.codeRef);
  return {
    key,
    types: types.length > 0 ? types : [key],
    isCardType: definition.type === 'card-def',
    fields,
  };
}

// The card types the field-match routes in `rules` name, each once, in the
// order they first appear. A caller looks these up before it validates.
export function hostRouteTypeRefs(
  rules: readonly RawHostRoutingRule[],
): ResolvedCodeRef[] {
  let refs = new Map<string, ResolvedCodeRef>();
  let visit = (list: readonly RawHostRoutingRule[]) => {
    for (let rule of list) {
      let ref = asCodeRef(rule.type);
      if (ref && !refs.has(typeLookupKey(ref))) {
        refs.set(typeLookupKey(ref), ref);
      }
      if (rule.routes) {
        visit(rule.routes);
      }
    }
  };
  visit(rules);
  return [...refs.values()];
}

// The key `hostRouteTypeRefs` dedupes on. A caller may key its lookup on it.
export function typeLookupKey(ref: ResolvedCodeRef): string {
  return `${ref.module}/${ref.name}`;
}

interface HostRouteBase {
  // Where the authored route sits: its index in the list at each level,
  // starting at the top. Stable for as long as the realm.json doesn't
  // change, so the routes editor can put a warning next to its route.
  position: readonly number[];
  name: string | undefined;
  // The route's own path, normalized: without a trailing slash, with `/`
  // kept for the realm root. A child's path is relative to its parent's.
  path: string;
  // The path from the realm root: the parents' paths and this one, joined.
  fullPath: string;
  // The `:name`s of the parents' paths, then those of this route's path,
  // in order.
  paramNames: readonly string[];
  // The child routes, in authored order.
  routes: readonly HostRoute[];
}

// A fixed card route: one path, one card (`instance`).
export interface HostFixedCardRoute extends HostRouteBase {
  kind: 'fixed-card';
  // The served URL of the card, as an href: the URL the realm is served at
  // and the index keys the card by, in this realm. Not an identifier
  // (ADR 002), so it is never in prefix form.
  cardHref: string;
  // The route's own path, parsed, with no `:name` segments. A top-level
  // fixed route's path is held to the rules it was always held to, so it
  // can be a path the parser rejects; then this is `undefined`, the route
  // still serves its card at `path`, and its child routes are dropped.
  pattern: RoutePathPattern | undefined;
}

// A redirect. When the full path has `:name` segments, it is a dynamic
// redirect: `target` is the target parsed, and the resolver fills it with
// the values the request path matched.
export interface HostRedirectRoute extends HostRouteBase {
  kind: 'redirect';
  // As authored, trimmed: a realm-relative path or an http(s) URL.
  redirectTo: string;
  statusCode: RedirectStatusCode;
  // Set as for a fixed card route. Always set on a dynamic redirect.
  pattern: RoutePathPattern | undefined;
  // Set only on a dynamic redirect. Its `:name`s are all in `paramNames`.
  target: HostRedirectTargetTemplate | undefined;
}

// A dynamic redirect target, `redirectTo` split in three: what comes before
// the path (an external target's origin, or nothing for a realm-relative
// target), the path as a pattern, and the query and fragment after it,
// copied as written.
export interface HostRedirectTargetTemplate {
  origin: string;
  pattern: RoutePathPattern;
  suffix: string;
}

// A card id template: the path's values fill `card`, and the card is loaded
// by id.
export interface HostCardIdRoute extends HostRouteBase {
  kind: 'card-id';
  pattern: RoutePathPattern;
  // Has at least one `:name`, every `:name` of the route's own path, and
  // otherwise only `:name`s of its parents' paths.
  card: CardIdPattern;
  // How a card this route resolves belongs to its parent route's card.
  // `undefined` for a route whose parent is fixed or that has no parent,
  // and for a route whose `card` uses its parent's own `:name`s, where the
  // id carries the nesting.
  parentLink: HostRouteParentLink | undefined;
  // 301 on an alias route: it resolves the card, then redirects to the
  // card's canonical address. Never canonical itself.
  statusCode: 301 | undefined;
}

// A field match: the path's values become one `eq` per field, plus `where`,
// on cards of `type`.
export interface HostFieldMatchRoute extends HostRouteBase {
  kind: 'field-match';
  pattern: RoutePathPattern;
  type: ResolvedCodeRef;
  // The key of `type`, as `HostRouteTypeInfo.key` spells it.
  typeKey: string;
  // Client-evaluable. `undefined` when the route has none.
  where: Filter | undefined;
  // One entry for each `:name` of the route's own path, in path order.
  // `field` is the field as authored, which may be a dotted path.
  match: readonly { field: string; param: string }[];
  // As on a card id template, except that it is always set when the parent
  // route is dynamic.
  parentLink: HostRouteParentLink | undefined;
  statusCode: 301 | undefined;
}

// The link that ties a dynamic child route's card to its parent route's
// card. `side` says which card holds the link: `child` for a field on the
// child's card that points to the parent's (a `linksTo`, or a
// `linksToMany` that holds it), `parent` for a field on the parent's card
// that points to the child's. When the type of either route isn't known
// (a card id template doesn't check types), a named `parent` can't be
// checked, and its side is `unverified`: the field may be on either card.
export type HostRouteParentLink =
  | {
      field: string;
      side: 'child' | 'parent';
      kind: 'linksTo' | 'linksToMany';
      // Whether validation inferred the link, as opposed to `parent` naming
      // it.
      inferred: boolean;
    }
  | { field: string; side: 'unverified'; inferred: false };

export type HostRoute =
  | HostFixedCardRoute
  | HostRedirectRoute
  | HostCardIdRoute
  | HostFieldMatchRoute;

export type HostRouteWarningCode =
  // The route has no usable `path`, or it doesn't parse.
  | 'invalid-path'
  // The route sets none of the four forms.
  | 'missing-form'
  // The route sets more than one form.
  | 'multiple-forms'
  // `name` is set but isn't a non-empty string.
  | 'invalid-name'
  // A top-level fixed route or a redirect without parameters has a segment
  // that starts with `:`, which it serves as literal text, not as a `:name`.
  | 'literal-param-segment'
  // `instance` has no usable id.
  | 'invalid-instance'
  // `instance` is a card in another realm.
  | 'cross-realm-instance'
  // A fixed card route with `:name` segments, or under a dynamic route.
  | 'fixed-route-with-params'
  // A redirect target that isn't usable. On a route that also has an
  // `instance`, the route serves that card instead and isn't dropped.
  | 'invalid-redirect-target'
  // A redirect target that uses a `:name` not in the route's path.
  | 'redirect-unknown-param'
  // A redirect that loops back to itself.
  | 'redirect-cycle'
  // A child of a redirect, which resolves no card to nest in.
  | 'redirect-with-children'
  // `card` doesn't parse.
  | 'invalid-card-pattern'
  // `card` has no `:name`.
  | 'card-pattern-without-param'
  // `card` uses a `:name` that isn't in the route's path or its parents'.
  | 'card-pattern-unknown-param'
  // A `:name` of the route's own path that `card` doesn't use.
  | 'card-pattern-missing-param'
  // `type` isn't a code ref.
  | 'invalid-type'
  // `type` isn't a card type the index knows.
  | 'not-card-type'
  // The definition of `type` can't be read now. The validation is
  // incomplete.
  | 'type-unavailable'
  // `match` is missing or malformed, or doesn't match each `:name` of the
  // route's own path with exactly one field.
  | 'invalid-match'
  // A `match` field the type doesn't have.
  | 'unknown-field'
  // `where` isn't a valid filter, or the browser can't evaluate it.
  | 'invalid-where'
  // A dynamic child route whose link to its parent route is missing,
  // ambiguous or not a link between the two types.
  | 'invalid-parent-link'
  // `parent` set where it has no meaning. Ignored.
  | 'ignored-parent'
  // `statusCode` other than 301 on a dynamic card route. Ignored.
  | 'ignored-status-code'
  // A route name an earlier route already has.
  | 'duplicate-name'
  // A fixed path an earlier fixed route already has.
  | 'duplicate-path'
  // A dynamic route past `MAX_DYNAMIC_HOST_ROUTES`.
  | 'dynamic-route-limit'
  // A route under a route that was dropped.
  | 'parent-dropped'
  // A nested route whose cards get no address from the card alone: only
  // the parent's card holds the link, and the type has no route of its
  // own. The route is kept.
  | 'no-address-from-one-card';

export interface HostRouteWarning {
  code: HostRouteWarningCode;
  // Human-readable, ready to show as is.
  message: string;
  // As `HostRoute.position`.
  position: readonly number[];
  // The route's full path as far as it could be read.
  path: string;
  // Whether the route (and with it its child routes) was dropped.
  dropped: boolean;
}

export interface HostRoutesValidation {
  routes: readonly HostRoute[];
  warnings: readonly HostRouteWarning[];
  // False when `lookupType` answered `'unavailable'` for a type: its routes
  // were dropped for now, and a later validation may keep them. A caller
  // must not keep an incomplete validation as final.
  complete: boolean;
}

export interface ValidateHostRoutesOptions {
  // The URL the realm is served at, ending with `/`. A fixed route's card
  // must be in it.
  realmURL: URL;
  // The definition of a type a field-match route names. `undefined` when
  // there is no such type; `'unavailable'` when its definition can't be read
  // now (it isn't cached yet, or the read failed), which drops its routes
  // and makes the validation incomplete.
  lookupType: (
    type: ResolvedCodeRef,
  ) => HostRouteTypeInfo | 'unavailable' | undefined;
  // Defaults to `MAX_DYNAMIC_HOST_ROUTES`.
  maxDynamicRoutes?: number;
}

/**
 * Validates a realm's raw routing rules (`readRawHostRoutingRules`) and
 * returns the routes to route on, in authored order, and a warning for
 * every route dropped or in doubt. A dropped route drops its child routes.
 * Never throws.
 */
export function validateHostRoutes(
  rules: readonly RawHostRoutingRule[],
  options: ValidateHostRoutesOptions,
): HostRoutesValidation {
  let validator = new Validator(options);
  return validator.run(rules);
}

/**
 * The routing map of fixed paths the server has always served: each
 * top-level fixed card route and fixed redirect, in authored order.
 */
export function hostRoutingMapFromRoutes(
  routes: readonly HostRoute[],
): HostRoutingRule[] {
  return routes.flatMap((route): HostRoutingRule[] => {
    if (route.kind === 'fixed-card') {
      return [{ path: route.fullPath, id: route.cardHref }];
    }
    if (route.kind === 'redirect' && !route.target) {
      return [
        {
          path: route.fullPath,
          redirectTo: route.redirectTo,
          statusCode: route.statusCode,
        },
      ];
    }
    return [];
  });
}

// What a child route needs to know of the route it is under.
interface ParentContext {
  route: HostRoute;
  typeInfo: HostRouteTypeInfo | undefined;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

class Validator {
  private warnings: HostRouteWarning[] = [];
  private complete = true;
  private realmPaths: RealmPaths;
  private options: ValidateHostRoutesOptions;

  constructor(options: ValidateHostRoutesOptions) {
    this.options = options;
    this.realmPaths = new RealmPaths(options.realmURL);
  }

  run(rules: readonly RawHostRoutingRule[]): HostRoutesValidation {
    let routes = this.validateList(rules, [], undefined);
    // Duplicates first, so a route dropped as a duplicate takes no part in
    // a redirect cycle.
    routes = this.applyRealmWideRules(routes);
    routes = this.dropRedirectCycles(routes);
    this.warnNoAddressFromOneCard(routes);
    return { routes, warnings: this.warnings, complete: this.complete };
  }

  private validateList(
    rules: readonly RawHostRoutingRule[],
    position: readonly number[],
    parent: ParentContext | undefined,
  ): HostRoute[] {
    let out: HostRoute[] = [];
    for (let [index, rule] of rules.entries()) {
      let route = this.validateRoute(rule, [...position, index], parent);
      if (route) {
        out.push(route);
      }
    }
    return out;
  }

  private validateRoute(
    rule: RawHostRoutingRule,
    position: readonly number[],
    parent: ParentContext | undefined,
  ): HostRoute | undefined {
    let parentRoute = parent?.route;
    let displayPath = joinPaths(
      parentRoute?.fullPath ?? '/',
      typeof rule.path === 'string' ? rule.path : '',
    );
    let drop = (code: HostRouteWarningCode, message: string) => {
      this.warn(code, message, position, displayPath, true);
      this.warnDescendantsDropped(rule.routes, position, displayPath);
      return undefined;
    };

    if (typeof rule.path !== 'string') {
      return drop('invalid-path', 'Route has no path');
    }
    if (
      parentRoute &&
      parentRoute.kind !== 'fixed-card' &&
      parentRoute.kind !== 'card-id' &&
      parentRoute.kind !== 'field-match'
    ) {
      return drop(
        'redirect-with-children',
        'A redirect resolves no card, so it cannot have child routes',
      );
    }
    if (parentRoute && !parentPattern(parentRoute)) {
      return drop(
        'invalid-path',
        `Its parent's path "${parentRoute.fullPath}" is not a valid route path, so it cannot have child routes`,
      );
    }

    let hasInstance = rule.instance !== undefined;
    let hasRedirect = !isBlank(rule.redirectTo);
    let hasCard = !isBlank(rule.card);
    let hasFieldMatch =
      rule.type !== undefined ||
      !isEmptyObject(rule.match) ||
      !isEmptyObject(rule.where);
    let formCount = [hasInstance, hasRedirect, hasCard, hasFieldMatch].filter(
      Boolean,
    ).length;
    if (formCount === 0) {
      return drop(
        'missing-form',
        'Route must set one of instance, redirectTo, card, or type and match',
      );
    }
    // A redirect with an instance is the one combination a realm.json
    // could always have: the redirect wins, and the instance is the
    // fallback when the redirect target isn't usable.
    let legacyPair = formCount === 2 && hasInstance && hasRedirect;
    if (formCount > 1 && !legacyPair) {
      return drop(
        'multiple-forms',
        'Route must set only one of instance, redirectTo, card, or type and match',
      );
    }

    // A top-level fixed card route or redirect keeps the path rules it
    // always had, unless it is a redirect whose target uses a `:name`. A
    // segment that starts with `:` in its path is literal text, as it always
    // was (`/talks/:2024`): a fixed route has no `:name` segments.
    let legacy =
      !parentRoute &&
      (hasInstance || hasRedirect) &&
      !(hasRedirect && redirectTargetHasParam(rule.redirectTo));
    let literalPath = legacy && hasParamSegment(rule.path);
    if (literalPath) {
      let segments = rule.path
        .split('/')
        .filter((segment) => segment.startsWith(':'));
      this.warn(
        'literal-param-segment',
        `${segments.join(', ')} ${segments.length === 1 ? 'is' : 'are'} served as literal text, not as a :name: a fixed route, or a redirect whose target uses no :name, has no parameters`,
        position,
        displayPath,
        false,
      );
    }

    let name: string | undefined;
    if (rule.name !== undefined && !isBlank(rule.name)) {
      if (typeof rule.name === 'string') {
        name = rule.name.trim();
      } else if (legacy) {
        // These routes never had names, so a realm.json may hold anything
        // there; the route is served without one.
        this.warn(
          'invalid-name',
          'Route name must be a string; ignored',
          position,
          displayPath,
          false,
        );
      } else {
        return drop('invalid-name', 'Route name must be a string');
      }
    }

    let path = normalizeRoutingPath(rule.path);
    let pattern: RoutePathPattern | undefined;
    if (!literalPath) {
      let parsed = parseRoutePathPattern(path, {
        usedNames: parentRoute?.paramNames,
      });
      if (parsed.ok) {
        pattern = parsed.pattern;
      } else if (!legacy) {
        return drop('invalid-path', parsed.error.message);
      }
    }
    let base: Omit<HostRouteBase, 'routes'> & { routes: HostRoute[] } = {
      position,
      name,
      path,
      fullPath: joinPaths(parentRoute?.fullPath ?? '/', path),
      paramNames: [
        ...(parentRoute?.paramNames ?? []),
        ...(pattern?.paramNames ?? []),
      ],
      routes: [],
    };
    displayPath = base.fullPath;
    let parentIsDynamic =
      parentRoute?.kind === 'card-id' || parentRoute?.kind === 'field-match';

    if (
      !isBlank(rule.parent) &&
      !parentIsDynamic &&
      (hasCard || hasFieldMatch)
    ) {
      this.warn(
        'ignored-parent',
        parentRoute
          ? 'parent is ignored on a route under a fixed route'
          : 'parent is ignored on a top-level route',
        position,
        displayPath,
        false,
      );
    }

    let route: Mutable<HostRoute> | undefined;
    let typeInfo: HostRouteTypeInfo | undefined;

    if (hasRedirect) {
      let redirectTo =
        typeof rule.redirectTo === 'string' ? rule.redirectTo.trim() : '';
      let warning =
        typeof rule.redirectTo === 'string'
          ? validateRedirectTarget(redirectTo)
          : 'Redirect target must be a string';
      let target: HostRedirectTargetTemplate | undefined;
      if (!warning && base.paramNames.length > 0) {
        let result = parseRedirectTargetTemplate(redirectTo);
        if (typeof result === 'string') {
          warning = result;
        } else {
          let unknown = result.pattern.paramNames.find(
            (n) => !base.paramNames.includes(n),
          );
          if (unknown) {
            return drop(
              'redirect-unknown-param',
              `Redirect target uses :${unknown}, which is not in the route's path`,
            );
          }
          target = result;
        }
      }
      if (warning) {
        if (!hasInstance) {
          return drop('invalid-redirect-target', warning);
        }
        this.warn(
          'invalid-redirect-target',
          `${warning}; the route serves its instance instead`,
          position,
          displayPath,
          false,
        );
      } else {
        route = {
          ...base,
          kind: 'redirect',
          redirectTo,
          statusCode:
            parseRedirectStatusCode(rule.statusCode) ?? DEFAULT_REDIRECT_STATUS,
          pattern,
          target,
        };
      }
    }

    if (!route && hasInstance) {
      if (base.paramNames.length > 0) {
        return drop(
          'fixed-route-with-params',
          'A fixed route cannot have :name segments in its path or be under a dynamic route',
        );
      }
      let id =
        rule.instance && typeof rule.instance === 'object'
          ? (rule.instance as Record<string, unknown>).id
          : undefined;
      let idURL = typeof id === 'string' ? safeURL(id) : undefined;
      if (typeof id !== 'string' || !idURL) {
        return drop('invalid-instance', 'Route instance is not a card');
      }
      // The serve-index rewrite would otherwise serve another realm's
      // prerendered HTML, a private realm's included, at this realm's path.
      if (!this.realmPaths.inRealm(idURL)) {
        return drop(
          'cross-realm-instance',
          `Route instance ${id} is outside this realm`,
        );
      }
      route = { ...base, kind: 'fixed-card', cardHref: id, pattern };
    }

    if (!route && hasCard) {
      if (typeof rule.card !== 'string') {
        return drop('invalid-card-pattern', 'card must be a string');
      }
      let cardResult = parseCardIdPattern(rule.card.trim());
      if (!cardResult.ok) {
        return drop('invalid-card-pattern', cardResult.error.message);
      }
      let card = cardResult.pattern;
      if (card.paramNames.length === 0) {
        return drop(
          'card-pattern-without-param',
          'card must have at least one :name segment',
        );
      }
      let unknown = card.paramNames.find((n) => !base.paramNames.includes(n));
      if (unknown) {
        return drop(
          'card-pattern-unknown-param',
          `card uses :${unknown}, which is not in the route's path`,
        );
      }
      let missing = pattern!.paramNames.find(
        (n) => !card.paramNames.includes(n),
      );
      if (missing) {
        return drop(
          'card-pattern-missing-param',
          `card must use :${missing} from the route's path`,
        );
      }
      let parentLink: HostRouteParentLink | undefined;
      if (parentIsDynamic) {
        let embedsParent = parentPattern(parentRoute!)!.paramNames.some((n) =>
          card.paramNames.includes(n),
        );
        if (!isBlank(rule.parent) || !embedsParent) {
          let link = this.resolveParentLink(rule.parent, undefined, parent!);
          if (typeof link === 'string') {
            return drop('invalid-parent-link', link);
          }
          parentLink = link;
        }
      }
      route = {
        ...base,
        kind: 'card-id',
        pattern: pattern!,
        card,
        parentLink,
        statusCode: this.aliasStatusCode(rule, position, displayPath),
      };
    }

    if (!route && hasFieldMatch) {
      let type = asCodeRef(rule.type);
      if (!type) {
        return drop('invalid-type', 'type must name a module and an export');
      }
      let found = this.options.lookupType(type);
      if (found === 'unavailable') {
        this.complete = false;
        return drop(
          'type-unavailable',
          `The definition of ${type.name} from ${type.module} is not available yet`,
        );
      }
      typeInfo = found;
      if (!typeInfo || !typeInfo.isCardType) {
        return drop(
          'not-card-type',
          `type ${type.name} from ${type.module} is not a card type`,
        );
      }
      let match = this.validateMatch(rule.match, pattern!, typeInfo);
      if ('code' in match) {
        return drop(match.code, match.message);
      }
      let where: Filter | undefined;
      if (!isEmptyObject(rule.where)) {
        let whereWarning = checkWhere(rule.where);
        if (whereWarning) {
          return drop('invalid-where', whereWarning);
        }
        where = rule.where as Filter;
      }
      let parentLink: HostRouteParentLink | undefined;
      if (parentIsDynamic) {
        let link = this.resolveParentLink(rule.parent, typeInfo, parent!);
        if (typeof link === 'string') {
          return drop('invalid-parent-link', link);
        }
        parentLink = link;
      }
      route = {
        ...base,
        kind: 'field-match',
        pattern: pattern!,
        type,
        typeKey: typeInfo.key,
        where,
        match,
        parentLink,
        statusCode: this.aliasStatusCode(rule, position, displayPath),
      };
    }

    if (!route) {
      // A redirect whose target fell back to an instance that turned out
      // not usable either was dropped above; nothing else reaches here.
      return drop('missing-form', 'Route has no usable form');
    }

    if (rule.routes && rule.routes.length > 0) {
      route.routes = this.validateList(rule.routes, position, {
        route: route as HostRoute,
        typeInfo,
      });
    }
    return route as HostRoute;
  }

  private validateMatch(
    raw: unknown,
    pattern: RoutePathPattern,
    typeInfo: HostRouteTypeInfo,
  ):
    | HostFieldMatchRoute['match']
    | { code: 'invalid-match' | 'unknown-field'; message: string } {
    let invalid = (message: string) => ({
      code: 'invalid-match' as const,
      message,
    });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return invalid('match must map card fields to :names of the route path');
    }
    let byParam = new Map<string, string>();
    for (let [field, value] of Object.entries(raw as Record<string, unknown>)) {
      let param =
        typeof value === 'string' && value.trim().startsWith(':')
          ? value.trim().slice(1)
          : undefined;
      if (!param) {
        return invalid(
          `match value for ${field} must be a :name of the route path`,
        );
      }
      if (!pattern.paramNames.includes(param)) {
        return invalid(
          `match uses :${param}, which is not in the route's own path`,
        );
      }
      if (byParam.has(param)) {
        return invalid(`:${param} is matched by more than one field`);
      }
      let [topField, ...rest] = field.split('.');
      if (!Object.prototype.hasOwnProperty.call(typeInfo.fields, topField!)) {
        return {
          code: 'unknown-field',
          message: `Card type has no field ${topField}`,
        };
      }
      // A path value is one string, so it can only equal a primitive value:
      // a link or a compound field is matched through a dotted path into it.
      if (rest.length === 0 && !typeInfo.fields[topField!]!.isPrimitive) {
        return invalid(
          `${field} is a link or a compound field; match one of its fields with a dotted path, such as ${field}.slug`,
        );
      }
      byParam.set(param, field);
    }
    let unmatched = pattern.paramNames.find((n) => !byParam.has(n));
    if (unmatched) {
      return invalid(`:${unmatched} is not matched by any field`);
    }
    if (pattern.paramNames.length === 0) {
      return invalid(
        'A field-match route must have at least one :name in its own path',
      );
    }
    return pattern.paramNames.map((param) => ({
      field: byParam.get(param)!,
      param,
    }));
  }

  // The link between a dynamic child route and its dynamic parent route,
  // named or inferred, or a warning.
  private resolveParentLink(
    rawParent: unknown,
    childType: HostRouteTypeInfo | undefined,
    parent: ParentContext,
  ): HostRouteParentLink | string {
    let parentType = parent.typeInfo;
    let named =
      typeof rawParent === 'string' && rawParent.trim()
        ? rawParent.trim()
        : undefined;
    if (rawParent !== undefined && !isBlank(rawParent) && !named) {
      return 'parent must be the name of a link field';
    }
    if (!childType || !parentType) {
      if (named) {
        // Only one side's type is known, at most. The field is on the child
        // when the child's type has it as a link: a link from the child to
        // its parent is the one each card can be addressed by. When only the
        // parent's type is known, a link field of that name on it doesn't
        // show which card holds the link, since the child's card may have a
        // field of that name too, so it is left for the resolver to read on
        // whichever card has it, as is a field the known type doesn't have.
        let field = childType?.fields[named];
        if (field && isLinkType(field.type)) {
          return {
            field: named,
            side: 'child',
            kind: field.type,
            inferred: false,
          };
        }
        return { field: named, side: 'unverified', inferred: false };
      }
      return "parent must name the link field that connects this route's card to its parent route's card: a card id template has no type to infer it from";
    }
    let candidates = linkCandidates(childType, parentType);
    if (named) {
      let matching = candidates.filter((c) => c.field === named);
      if (matching.length === 1) {
        return { ...matching[0]!, inferred: false };
      }
      if (matching.length > 1) {
        return `parent ${named} is ambiguous: both cards have a link field ${named} to the other`;
      }
      return `parent ${named} is not a linksTo or linksToMany field connecting the two routes' card types`;
    }
    if (candidates.length === 1) {
      return { ...candidates[0]!, inferred: true };
    }
    if (candidates.length === 0) {
      return "No linksTo or linksToMany field connects this route's card type to its parent route's card type";
    }
    return `parent is required: more than one link connects the two card types (${candidates
      .map((c) => `${c.side === 'child' ? 'child' : 'parent'}.${c.field}`)
      .join(', ')})`;
  }

  private aliasStatusCode(
    rule: RawHostRoutingRule,
    position: readonly number[],
    path: string,
  ): 301 | undefined {
    if (rule.statusCode === undefined) {
      return undefined;
    }
    if (parseRedirectStatusCode(rule.statusCode) === 301) {
      return 301;
    }
    this.warn(
      'ignored-status-code',
      'statusCode on a dynamic card route can only be 301, which makes it an alias that redirects to the canonical address; ignored',
      position,
      path,
      false,
    );
    return undefined;
  }

  // Drops the fixed redirects that loop back to themselves. Every fixed
  // card route and redirect takes part, top-level or not, in authored
  // order, as the routing map always checked them.
  private dropRedirectCycles(routes: HostRoute[]): HostRoute[] {
    let fixed: { path: string; redirectTo?: string }[] = [];
    walk(routes, (route) => {
      if (route.kind === 'fixed-card') {
        fixed.push({ path: route.fullPath });
      } else if (route.kind === 'redirect' && !route.target) {
        fixed.push({ path: route.fullPath, redirectTo: route.redirectTo });
      }
    });
    let looping = new Set(findRedirectCycles(fixed));
    if (looping.size === 0) {
      return routes;
    }
    return this.filterTree(routes, (route) =>
      route.kind === 'redirect' && !route.target && looping.has(route.fullPath)
        ? {
            code: 'redirect-cycle',
            message: 'Redirect target loops back to this route',
          }
        : undefined,
    );
  }

  // Unique names, unique fixed paths and the dynamic route limit, applied
  // in depth-first authored order: the earlier route wins.
  private applyRealmWideRules(routes: HostRoute[]): HostRoute[] {
    let names = new Set<string>();
    let fixedPaths = new Set<string>();
    let dynamicCount = 0;
    let max = this.options.maxDynamicRoutes ?? MAX_DYNAMIC_HOST_ROUTES;
    return this.filterTree(routes, (route) => {
      if (route.name !== undefined && names.has(route.name)) {
        return {
          code: 'duplicate-name',
          message: `Another route is already named ${route.name}`,
        };
      }
      if (isDynamic(route)) {
        if (dynamicCount >= max) {
          return {
            code: 'dynamic-route-limit',
            message: `A realm can have at most ${max} dynamic routes`,
          };
        }
        dynamicCount++;
      } else {
        if (fixedPaths.has(route.fullPath)) {
          return {
            code: 'duplicate-path',
            message: `Another fixed route already has the path ${route.fullPath}`,
          };
        }
        fixedPaths.add(route.fullPath);
      }
      if (route.name !== undefined) {
        names.add(route.name);
      }
      return undefined;
    });
  }

  // D24: a nested route whose link to its parent is held only by the
  // parent's card gives one card alone no address, unless the card's type
  // also has a route outside any dynamic route.
  private warnNoAddressFromOneCard(routes: readonly HostRoute[]): void {
    let standaloneTypes = new Set<string>();
    let visit = (list: readonly HostRoute[], underDynamic: boolean) => {
      for (let route of list) {
        if (route.kind === 'field-match' && !underDynamic) {
          standaloneTypes.add(route.typeKey);
        }
        visit(route.routes, underDynamic || isDynamicCardRoute(route));
      }
    };
    visit(routes, false);
    walk(routes, (route) => {
      if (
        (route.kind === 'field-match' || route.kind === 'card-id') &&
        route.parentLink?.side === 'parent'
      ) {
        if (route.kind === 'field-match') {
          let info = this.options.lookupType(route.type);
          if (
            info &&
            info !== 'unavailable' &&
            info.types.some((key) => standaloneTypes.has(key))
          ) {
            return;
          }
        }
        this.warn(
          'no-address-from-one-card',
          `Only the parent route's card links to this route's card (${route.parentLink.field}), so a link to the card alone gets no address here; give the card a link to its parent or its type a route of its own`,
          route.position,
          route.fullPath,
          false,
        );
      }
    });
  }

  // Keeps the routes `reject` returns nothing for, with their child routes
  // filtered the same way, depth-first.
  private filterTree(
    routes: readonly HostRoute[],
    reject: (
      route: HostRoute,
    ) => { code: HostRouteWarningCode; message: string } | undefined,
  ): HostRoute[] {
    let out: HostRoute[] = [];
    for (let route of routes) {
      let rejection = reject(route);
      if (rejection) {
        this.warn(
          rejection.code,
          rejection.message,
          route.position,
          route.fullPath,
          true,
        );
        walk(route.routes, (child) =>
          this.warn(
            'parent-dropped',
            'Dropped with the route it is under',
            child.position,
            child.fullPath,
            true,
          ),
        );
        continue;
      }
      let children = this.filterTree(route.routes, reject);
      out.push(
        children.length === route.routes.length &&
          children.every((c, i) => c === route.routes[i])
          ? route
          : ({ ...route, routes: children } as HostRoute),
      );
    }
    return out;
  }

  private warnDescendantsDropped(
    rules: readonly RawHostRoutingRule[] | undefined,
    position: readonly number[],
    parentPath: string,
  ): void {
    for (let [index, rule] of (rules ?? []).entries()) {
      let childPosition = [...position, index];
      let path = joinPaths(
        parentPath,
        typeof rule.path === 'string' ? rule.path : '',
      );
      this.warn(
        'parent-dropped',
        'Dropped with the route it is under',
        childPosition,
        path,
        true,
      );
      this.warnDescendantsDropped(rule.routes, childPosition, path);
    }
  }

  private warn(
    code: HostRouteWarningCode,
    message: string,
    position: readonly number[],
    path: string,
    dropped: boolean,
  ): void {
    this.warnings.push({ code, message, position, path, dropped });
  }
}

// The link fields that connect a child route's type and its parent route's
// type, in either direction. A field that connects them both ways (the two
// types are the same, or one descends from the other) counts once: a
// `linksTo` as the child's link to its parent, a `linksToMany` as the
// parent's list of its children.
function linkCandidates(
  childType: HostRouteTypeInfo,
  parentType: HostRouteTypeInfo,
): {
  field: string;
  side: 'child' | 'parent';
  kind: 'linksTo' | 'linksToMany';
}[] {
  let out: {
    field: string;
    side: 'child' | 'parent';
    kind: 'linksTo' | 'linksToMany';
  }[] = [];
  let sameFields = childType.key === parentType.key;
  for (let [field, def] of Object.entries(childType.fields)) {
    if (!isLinkType(def.type) || !def.target) {
      continue;
    }
    let toParent = parentType.types.includes(def.target);
    let toChild = childType.types.includes(def.target);
    if (toParent && !(sameFields && toChild && def.type === 'linksToMany')) {
      out.push({ field, side: 'child', kind: def.type });
    }
  }
  for (let [field, def] of Object.entries(parentType.fields)) {
    if (!isLinkType(def.type) || !def.target) {
      continue;
    }
    let toChild = childType.types.includes(def.target);
    let toParent = parentType.types.includes(def.target);
    if (toChild && !(sameFields && toParent && def.type === 'linksTo')) {
      out.push({ field, side: 'parent', kind: def.type });
    }
  }
  return out;
}

function isLinkType(
  type: FieldDefinition['type'],
): type is 'linksTo' | 'linksToMany' {
  return type === 'linksTo' || type === 'linksToMany';
}

function isDynamicCardRoute(route: HostRoute): boolean {
  return route.kind === 'card-id' || route.kind === 'field-match';
}

function isDynamic(route: HostRoute): boolean {
  return (
    isDynamicCardRoute(route) || (route.kind === 'redirect' && !!route.target)
  );
}

function parentPattern(route: HostRoute): RoutePathPattern | undefined {
  return route.pattern;
}

function walk(
  routes: readonly HostRoute[],
  visit: (route: HostRoute) => void,
): void {
  for (let route of routes) {
    visit(route);
    walk(route.routes, visit);
  }
}

function joinPaths(parentFullPath: string, path: string): string {
  let own = normalizeRoutingPath(path);
  if (parentFullPath === '/') {
    return own;
  }
  return own === '/' ? parentFullPath : `${parentFullPath}${own}`;
}

function hasParamSegment(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith(':'));
}

function redirectTargetHasParam(redirectTo: unknown): boolean {
  return (
    typeof redirectTo === 'string' &&
    hasParamSegment(redirectTo.trim().split(/[?#]/, 1)[0]!)
  );
}

const EXTERNAL_ORIGIN = /^(https?:\/\/[^/?#]*)/i;

// Splits a dynamic redirect target into its origin, its path as a pattern,
// and its query and fragment. Returns a warning when the path doesn't
// parse.
function parseRedirectTargetTemplate(
  target: string,
): HostRedirectTargetTemplate | string {
  let origin = target.match(EXTERNAL_ORIGIN)?.[1] ?? '';
  let rest = target.slice(origin.length) || '/';
  let suffixStart = rest.search(/[?#]/);
  let path = suffixStart === -1 ? rest : rest.slice(0, suffixStart);
  let suffix = suffixStart === -1 ? '' : rest.slice(suffixStart);
  let parsed = parseRoutePathPattern(path || '/');
  if (!parsed.ok) {
    return `Redirect target path: ${parsed.error.message}`;
  }
  return { origin, pattern: parsed.pattern, suffix };
}

function checkWhere(where: unknown): string | undefined {
  if (!where || typeof where !== 'object' || Array.isArray(where)) {
    return 'where must be a filter object';
  }
  try {
    assertQuery({ filter: where });
  } catch (e: unknown) {
    return `where is not a valid filter: ${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    if (!isClientEvaluable(where as Filter)) {
      return 'where must be a filter the browser can evaluate (no matches)';
    }
  } catch {
    return 'where must be a filter the browser can evaluate (no matches)';
  }
  return undefined;
}

function asCodeRef(value: unknown): ResolvedCodeRef | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  let { module, name } = value as Record<string, unknown>;
  return typeof module === 'string' &&
    module &&
    typeof name === 'string' &&
    name
    ? { module: rri(module), name }
    : undefined;
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function isEmptyObject(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0)
  );
}

function safeURL(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

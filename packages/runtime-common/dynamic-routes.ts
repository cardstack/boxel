import { parseBxlAst, prepareBxl, type PreparedBxl } from '@cardstack/bxl';

import { normalizeRoutingPath } from './host-routing-validation.ts';
import type { Query } from './query.ts';
import { redirectSegmentNames } from './site-settings.ts';

// Routing rules whose path has `:name` segments (the Host Mode Dynamic Routes
// spec, kept as the fallback for paths the route table doesn't hold). A
// `:name` segment matches exactly one whole, non-empty path segment, and the
// match is a segment-by-segment comparison: linear in the path and the
// pattern, with no regular expression (ADR 015 §1.3). The rule's `query` is
// BXL in the route profile; its input is `{"route": {<name>: <value>}}` and
// its output must be a Boxel query, which the server narrows (ADR 015 §1.4).

export const MAX_DYNAMIC_ROUTES = 20;

const QUERY_LIMITS = { maxSteps: 10_000, maxOutputs: 1, maxMillis: 50 };

export interface DynamicRoute {
  // As authored, normalized: '/posts/:slug'.
  path: string;
  segments: ({ literal: string } | { name: string })[];
  query: PreparedBxl;
}

export function isDynamicRoutingPath(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith(':'));
}

// The dynamic rules among a realm's routing rules, validated, in declared
// order. Each invalid rule is reported and dropped.
export function readDynamicRoutes(rules: unknown): {
  routes: DynamicRoute[];
  problems: string[];
} {
  let problems: string[] = [];
  let routes: DynamicRoute[] = [];
  for (let rule of Array.isArray(rules) ? rules : []) {
    if (!rule || typeof rule !== 'object') {
      continue;
    }
    let { path, query, instance, redirectTo } = rule as Record<string, unknown>;
    if (typeof path !== 'string' || !isDynamicRoutingPath(path)) {
      continue;
    }
    let label = `routing rule "${path}"`;
    if (routes.length >= MAX_DYNAMIC_ROUTES) {
      problems.push(
        `${label}: only the first ${MAX_DYNAMIC_ROUTES} dynamic rules are read`,
      );
      continue;
    }
    if (
      (instance && typeof instance === 'object') ||
      (typeof redirectTo === 'string' && redirectTo.trim())
    ) {
      problems.push(
        `${label}: a dynamic rule takes a query, not a card or redirect`,
      );
      continue;
    }
    let normalized = normalizeRoutingPath(path.trim());
    let names = redirectSegmentNames(normalized);
    if ('problem' in names) {
      problems.push(`${label}: ${names.problem}`);
      continue;
    }
    if (typeof query !== 'string' || !query.trim()) {
      problems.push(`${label}: no query`);
      continue;
    }
    let compiled: PreparedBxl;
    try {
      let ast = parseBxlAst(query, { profile: 'route', readableSyntax: false });
      let errors = ast.profileIssues.filter((i) => i.severity === 'error');
      if (errors.length) {
        problems.push(
          `${label}: query: ${errors.map((e) => e.message).join('; ')}`,
        );
        continue;
      }
      compiled = prepareBxl(query, {
        readableSyntax: false,
        runtimeLimits: QUERY_LIMITS,
      });
    } catch (e) {
      problems.push(
        `${label}: query: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    routes.push({
      path: normalized,
      segments: normalized
        .split('/')
        .slice(1)
        .map((segment) =>
          segment.startsWith(':')
            ? { name: segment.slice(1) }
            : { literal: segment },
        ),
      query: compiled,
    });
  }
  return { routes, problems };
}

// The `:name` values a path gives a route, or undefined when it doesn't
// match. `path` is realm-relative and normalized.
export function matchDynamicRoute(
  route: Pick<DynamicRoute, 'segments'>,
  path: string,
): Record<string, string> | undefined {
  let parts = path.split('/').slice(1);
  if (parts.length !== route.segments.length) {
    return undefined;
  }
  let params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    let segment = route.segments[i];
    if ('literal' in segment) {
      if (segment.literal !== parts[i]) {
        return undefined;
      }
    } else {
      if (!parts[i]) {
        return undefined;
      }
      try {
        params[segment.name] = decodeURIComponent(parts[i]);
      } catch {
        return undefined;
      }
    }
  }
  return params;
}

// The query a rule makes for a match, narrowed so it can only search the
// rule's own realm and only for one card (spec D4). Undefined when the
// expression fails or produces something that isn't a query.
export function dynamicRouteQuery(
  route: Pick<DynamicRoute, 'query'>,
  params: Record<string, string>,
): Query | undefined {
  let value: unknown;
  try {
    value = route.query.evaluate({ route: params }).value;
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  let query = { ...(value as Record<string, unknown>) };
  delete query.realm;
  delete query.realms;
  delete query.asData;
  delete query.fields;
  if (
    query.filter !== undefined &&
    (typeof query.filter !== 'object' || !query.filter)
  ) {
    return undefined;
  }
  if (query.sort !== undefined && !Array.isArray(query.sort)) {
    return undefined;
  }
  query.page = { number: 0, size: 1 };
  return query as Query;
}

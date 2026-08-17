/*! @license
 * Synchronous TypeScript adaptation of OpenFGA recursive userset resolution.
 * Upstream: openfga/openfga@2c19e265fc73858fc0a5468fc517dc3bbf727e94
 * Source: internal/graph/recursive_resolver.go
 * Functions adapted: processUsersetMessage, breadthFirstRecursiveMatch
 * Copyright OpenFGA Authors. Licensed under Apache-2.0.
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export const OPENFGA_RECURSIVE_PORT_INFO = Object.freeze({
  upstream: 'openfga/openfga',
  commit: '2c19e265fc73858fc0a5468fc517dc3bbf727e94',
  source: 'internal/graph/recursive_resolver.go',
  upstreamFunctions: Object.freeze([
    'processUsersetMessage',
    'breadthFirstRecursiveMatch',
  ]),
  portFunctions: Object.freeze([
    'processUsersetMessage',
    'breadthFirstRecursiveMatchSync',
  ]),
  execution: 'synchronous-in-memory',
  license: 'Apache-2.0',
} as const);

export interface RecursiveUsersetExpansion {
  matched: boolean;
  children: readonly string[];
}

export interface RecursiveUsersetVisit {
  userset: string;
  depth: number;
}

export interface RecursiveUsersetMatch {
  matched: boolean;
  path: readonly string[];
  visited: readonly RecursiveUsersetVisit[];
  cyclePruned: number;
  depthExceeded: boolean;
}

/**
 * Direct synchronous port of OpenFGA's processUsersetMessage set-intersection
 * primitive. The caller chooses what the two sets mean for its traversal.
 */
export function processUsersetMessage(
  userset: string,
  primarySet: Set<string>,
  secondarySet: ReadonlySet<string>,
): boolean {
  primarySet.add(userset);
  return secondarySet.has(userset);
}

function reconstructPath(
  userset: string,
  parentByUserset: ReadonlyMap<string, string | undefined>,
): readonly string[] {
  const reversed: string[] = [];
  let current: string | undefined = userset;
  while (current !== undefined) {
    reversed.push(current);
    current = parentByUserset.get(current);
  }
  return reversed.reverse();
}

/**
 * Synchronous in-memory adaptation of OpenFGA's breadthFirstRecursiveMatch.
 *
 * OpenFGA streams storage results and fans each breadth level out through a
 * worker pool. BXL already owns an immutable in-memory tuple index for one
 * computeVia call, so the same breadth-first, visited-userset and short-circuit
 * semantics run deterministically on the current thread.
 */
export function breadthFirstRecursiveMatchSync(
  initialUsersets: readonly string[],
  expand: (userset: string, depth: number) => RecursiveUsersetExpansion,
  maxDepth: number,
): RecursiveUsersetMatch {
  let currentUsersetLevel = new Set(initialUsersets);
  const visitedUsersets = new Set<string>();
  const parentByUserset = new Map<string, string | undefined>();
  const visited: RecursiveUsersetVisit[] = [];
  let cyclePruned = 0;
  let depth = 0;

  for (const userset of currentUsersetLevel) {
    parentByUserset.set(userset, undefined);
  }

  while (currentUsersetLevel.size > 0) {
    if (depth > maxDepth) {
      return {
        matched: false,
        path: [],
        visited,
        cyclePruned,
        depthExceeded: true,
      };
    }

    const nextUsersetLevel = new Set<string>();
    for (const userset of currentUsersetLevel) {
      if (visitedUsersets.has(userset)) {
        cyclePruned++;
        continue;
      }
      visitedUsersets.add(userset);
      visited.push({ userset, depth });

      const expansion = expand(userset, depth);
      if (expansion.matched) {
        return {
          matched: true,
          path: reconstructPath(userset, parentByUserset),
          visited,
          cyclePruned,
          depthExceeded: false,
        };
      }

      for (const child of expansion.children) {
        const alreadyVisited = processUsersetMessage(
          child,
          nextUsersetLevel,
          visitedUsersets,
        );
        if (alreadyVisited) {
          cyclePruned++;
          continue;
        }
        if (!parentByUserset.has(child)) {
          parentByUserset.set(child, userset);
        }
      }
    }

    currentUsersetLevel = nextUsersetLevel;
    depth++;
  }

  return {
    matched: false,
    path: [],
    visited,
    cyclePruned,
    depthExceeded: false,
  };
}

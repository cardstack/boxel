import { ensureTrailingSlash } from './paths';
import type { RealmVisibility } from './realm';

export interface ResourceIndexEntry {
  canonicalUrl: string;
  realmUrl: string;
  dependencies: string[];
}

export interface ExternalDependencySummary {
  dependency: string;
  via: string[];
  realmURL: string;
  realmVisibility: RealmVisibility;
}

export interface PublishabilityViolation {
  resource: string;
  externalDependencies: ExternalDependencySummary[];
}

export interface PublishabilityResult {
  publishable: boolean;
  violations: PublishabilityViolation[];
}

export interface PublishabilityGraph {
  sourceRealmURL: string;
  resources: string[];
  resourceEntries: Map<string, ResourceIndexEntry[]>;
  realmVisibility: Map<string, RealmVisibility>;
  isResourceInherentlyPublic?: (resourceUrl: string) => boolean;
}

type DependencyChain = string[];

/**
 * Determine whether a realm can be published by inspecting its dependencies.
 * Returns the list of problematic resources and the external dependencies that
 * prevent publication.
 */
export async function analyzeRealmPublishability({
  sourceRealmURL,
  resources,
  resourceEntries,
  realmVisibility,
  isResourceInherentlyPublic,
}: PublishabilityGraph): Promise<PublishabilityResult> {
  let violationsByResource = new Map<
    string,
    Map<string, ExternalDependencySummary>
  >();
  let memoizedChains = new Map<string, DependencyChain[]>();
  let normalizedRealmURL = ensureTrailingSlash(sourceRealmURL);
  let realmResources = new Set<string>(resources);

  async function collectChains(
    resourceUrl: string,
    ancestry: string[] = [],
  ): Promise<DependencyChain[]> {
    if (memoizedChains.has(resourceUrl)) {
      return memoizedChains.get(resourceUrl)!;
    }

    // Prevent circular traversal
    if (ancestry.includes(resourceUrl)) {
      return [];
    }
    let updatedAncestry = [...ancestry, resourceUrl];

    let entries = resourceEntries.get(resourceUrl);
    if (!entries || entries.length === 0) {
      memoizedChains.set(resourceUrl, []);
      return [];
    }

    let canonicalResourceUrl = entries[0].canonicalUrl;
    if (resourceUrl !== canonicalResourceUrl) {
      let chains = await collectChains(canonicalResourceUrl, ancestry);
      memoizedChains.set(resourceUrl, chains);
      return chains;
    }

    let chains: DependencyChain[] = [];
    for (let { dependencies } of entries) {
      for (let dependency of dependencies) {
        if (typeof dependency !== 'string' || dependency.trim() === '') {
          continue;
        }
        if (updatedAncestry.includes(dependency)) {
          continue;
        }
        // Some dependency entries are synthetic (e.g. base realm or scoped CSS)
        if (isResourceInherentlyPublic?.(dependency)) {
          continue;
        }

        let dependencyEntries = resourceEntries.get(dependency);
        if (!dependencyEntries || dependencyEntries.length === 0) {
          continue;
        }

        let [dependencyEntry] = dependencyEntries;
        let canonicalDependencyUrl = dependencyEntry.canonicalUrl;
        let dependencyRealmURL = ensureTrailingSlash(dependencyEntry.realmUrl);
        if (dependency !== canonicalDependencyUrl) {
          dependency = canonicalDependencyUrl;
        }

        if (dependencyRealmURL === normalizedRealmURL) {
          let subchains = await collectChains(dependency, updatedAncestry);
          for (let subchain of subchains) {
            chains.push([resourceUrl, ...subchain]);
          }
          continue;
        }

        let visibility = realmVisibility.get(dependencyRealmURL) ?? 'private';
        if (visibility !== 'public') {
          chains.push([resourceUrl, dependency]);
        }
        continue;
      }
    }

    let deduped = dedupeChains(chains);
    memoizedChains.set(resourceUrl, deduped);
    return deduped;
  }

  for (let resource of realmResources) {
    let chains = await collectChains(resource);
    if (chains.length === 0) {
      continue;
    }

    for (let chain of chains) {
      if (chain.length < 2) {
        continue;
      }

      let [origin, ...rest] = chain;
      let dependency = rest[rest.length - 1];

      let dependencyEntries = resourceEntries.get(dependency);
      if (!dependencyEntries || dependencyEntries.length === 0) {
        continue;
      }

      let dependencyRealmURL = ensureTrailingSlash(
        dependencyEntries[0].realmUrl,
      );
      let visibility = realmVisibility.get(dependencyRealmURL) ?? 'private';

      if (visibility === 'public') {
        continue;
      }

      let via =
        rest.length > 1 ? rest.slice(0, rest.length - 1) : ([] as string[]);

      let perResource =
        violationsByResource.get(origin) ??
        new Map<string, ExternalDependencySummary>();

      let key = `${dependency}|${via.join('>')}`;
      if (!perResource.has(key)) {
        perResource.set(key, {
          dependency,
          via,
          realmURL: dependencyRealmURL,
          realmVisibility: visibility,
        });
      }

      violationsByResource.set(origin, perResource);
    }
  }

  let violations: PublishabilityViolation[] = [];
  for (let [resource, summaries] of violationsByResource.entries()) {
    violations.push({
      resource,
      externalDependencies: [...summaries.values()],
    });
  }

  return {
    publishable: violations.length === 0,
    violations,
  };
}

function dedupeChains(chains: DependencyChain[]) {
  let seen = new Set<string>();
  let result: DependencyChain[] = [];
  for (let chain of chains) {
    let key = chain.join('>');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(chain);
  }
  return result;
}

import { isEqual } from 'lodash-es';
import { uniqWith } from 'lodash-es';
import { kebabCase } from 'lodash-es';
import { v4 as uuidv4 } from 'uuid';
import type { Spec } from '@cardstack/base/spec';
import type { CardDef } from '@cardstack/base/card-api';
import { RealmPaths, join } from './paths.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import { canonicalModuleKey, resolveAdoptsFrom } from './code-ref.ts';
import { baseRealmRRI, realmURL } from './constants.ts';
import { logger } from './log.ts';
import type { LocalPath } from './paths.ts';
import { ri, rri } from './realm-identifiers.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import { resolveRRIReference } from './url.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// Local mirror of the boxel-catalog Listing shape — that repo isn't cloned in boxel CI. (CS-11166)
export interface Listing extends CardDef {
  name?: string;
  summary?: string;
  specs: any[];
  examples: any[];
  skills: any[];
}

// Fold a module reference onto one canonical spelling. Callers do this once,
// where a ref enters the planner, so every decision below is a plain prefix
// test rather than a per-check sniff at the three forms a base-realm ref can
// arrive in (`@cardstack/base/x`, the `cardstack.com` alias, the real backing
// URL).
function canonicalRef(
  codeRef: ResolvedCodeRef,
  virtualNetwork: VirtualNetwork,
): ResolvedCodeRef {
  return {
    ...codeRef,
    module: rri(canonicalModuleKey(codeRef.module, virtualNetwork)),
  };
}

function isInBaseRealm(module: RealmResourceIdentifier): boolean {
  return module.startsWith(baseRealmRRI);
}

// The one place a canonical ref is resolved to a real URL. `sourceCodeRef`
// feeds the copy step's source read (`ReadSourceCommand`), which parses it with
// `new URL` and so cannot take a prefix RRI. Nothing else in the plan is
// materialized — in particular a base-realm `targetCodeRef` stays prefix form,
// because it is written into the installed card's `meta.adoptsFrom`, where an
// environment-specific URL would defeat the portability RRI exists to provide.
// CS-12198 tracks making that consumer RRI-aware, retiring this.
function fetchableRef(
  codeRef: ResolvedCodeRef,
  virtualNetwork: VirtualNetwork,
): ResolvedCodeRef {
  let module: string;
  try {
    module = virtualNetwork.toURLHref(codeRef.module);
  } catch (e) {
    // Fail while planning rather than handing an unresolvable identifier to the
    // copy step, where it would surface as a bare `Invalid URL` far from its
    // cause.
    let error = new Error(
      `Cannot resolve module "${codeRef.module}" to a fetchable URL; no realm mapping is registered for it`,
    );
    (error as any).cause = e;
    throw error;
  }
  return { ...codeRef, module: rri(module) };
}

// sourceCodeRef -- (installs module) --> targetCodeRef
// sourceCodeRef: code ref of the code from the source realm
// targetCodeRef: code ref of the code from the target realm
export interface CopyMeta {
  sourceCodeRef: ResolvedCodeRef;
  targetCodeRef: ResolvedCodeRef;
}

export interface CopyInstanceMeta {
  sourceCard: CardDef;
  targetCodeRef: ResolvedCodeRef;
  lid: string;
}
export interface InstallPlanInterface {
  modulesCopy: CopyMeta[];
  instancesCopy: CopyInstanceMeta[];
  get modulesToInstall(): CopyModuleMeta[];
}

export class InstallPlan implements InstallPlanInterface {
  modulesCopy: CopyMeta[];
  instancesCopy: CopyInstanceMeta[];
  constructor(modulesCopy: CopyMeta[], instancesCopy: CopyInstanceMeta[]) {
    this.modulesCopy = modulesCopy;
    this.instancesCopy = instancesCopy;
  }

  get modulesToInstall(): CopyModuleMeta[] {
    const uniqueModules = this.modulesCopy.reduce(
      (acc, { sourceCodeRef, targetCodeRef }) => {
        const key = `${sourceCodeRef.module}-${targetCodeRef.module}`;
        if (!acc.has(key)) {
          acc.set(key, {
            sourceModule: sourceCodeRef.module,
            targetModule: targetCodeRef.module,
          });
        }
        return acc;
      },
      new Map<string, CopyModuleMeta>(),
    );
    return Array.from(uniqueModules.values());
  }
}

export interface CopyModuleMeta {
  sourceModule: string;
  targetModule: string; //TODO: maybe we should use a lid??
}

export function generateInstallFolderName(
  name?: string,
  installDirId?: string,
): string {
  if (name && installDirId) {
    return `${kebabCase(name)}-${installDirId}`;
  } else if (!name && installDirId) {
    return installDirId;
  } else if (name && !installDirId) {
    return `${kebabCase(name)}-${uuidv4()}`;
  } else {
    return uuidv4();
  }
}

export class ListingPathResolver {
  targetDirectoryName: string; //name of outer uuid  folder
  private targetRealmPath: RealmPaths;
  private sourceRealmPath: RealmPaths;
  private targetDirectoryPath: RealmPaths;
  private foreignRealmPaths: RealmPaths[] = [];
  private virtualNetwork: VirtualNetwork;

  constructor(
    targetRealm: string,
    listing: Listing,
    installDirId: string | undefined,
    virtualNetwork: VirtualNetwork,
  ) {
    this.virtualNetwork = virtualNetwork;
    this.targetRealmPath = new RealmPaths(new URL(targetRealm), virtualNetwork);

    const listingDirectoryName = kebabCase(listing.name);

    this.targetDirectoryName = generateInstallFolderName(
      listingDirectoryName,
      installDirId,
    );

    const sourceRealmURL = listing[realmURL];
    if (!sourceRealmURL) {
      throw new Error('Cannot derive realm from listing');
    }

    this.sourceRealmPath = this.canonicalRealmPath(sourceRealmURL);
    this.targetDirectoryPath = new RealmPaths(
      new URL(join(this.targetRealmPath.url, this.targetDirectoryName)),
      virtualNetwork,
    );
  }

  // The realms we measure ids against must be in the same form as the ids
  // themselves: `RealmPaths.local` slices the id by `realm.url.length`, which
  // silently yields garbage when one side is a prefix RRI and the other its
  // real URL. Canonicalizing here keeps that slice honest for mapped realms
  // (the catalog, which is exactly the source realm in production). Unmapped
  // realms canonicalize to themselves, so this is a no-op for them.
  private canonicalRealmPath(realm: URL): RealmPaths {
    return new RealmPaths(
      ri(canonicalModuleKey(realm.href, this.virtualNetwork)),
      this.virtualNetwork,
    );
  }

  addKnownRealmURL(url: URL): void {
    let realmPath = this.canonicalRealmPath(url);
    if (
      realmPath.url !== this.sourceRealmPath.url &&
      !this.foreignRealmPaths.some((p) => p.url === realmPath.url)
    ) {
      this.foreignRealmPaths.push(realmPath);
    }
  }

  // Takes a canonical identifier, not an href: `RealmPaths.local`/`inRealm`
  // work on either form directly, so there is no round-trip through `new URL`
  // — which would silently mis-join a prefix RRI onto the source realm
  // (`@cardstack/base/skill` → `<sourceRealm>/@cardstack/base/skill`).
  local(id: RealmResourceIdentifier): LocalPath {
    if (this.sourceRealmPath.inRealm(id)) {
      return this.sourceRealmPath.local(id);
    }
    // Try known foreign realm paths (longest URL first to handle nested realms)
    let sorted = [...this.foreignRealmPaths].sort(
      (a, b) => b.url.length - a.url.length,
    );
    for (let foreignPath of sorted) {
      if (foreignPath.inRealm(id)) {
        return foreignPath.local(id);
      }
    }
    return this.localFallback(id);
  }

  // No known realm contains this id: strip just the realm-identifying prefix
  // and keep the rest of the path. That prefix is the origin for a URL, and the
  // `@scope/name` namespace for a prefix RRI.
  private localFallback(id: RealmResourceIdentifier): LocalPath {
    if (id.startsWith('@')) {
      return id.split('/').slice(2).join('/').replace(/\/+$/, '');
    }
    try {
      let { pathname } = new URL(id);
      return decodeURI(pathname).replace(/^\//, '').replace(/\/+$/, '');
    } catch {
      return id.replace(/^\//, '').replace(/\/+$/, '');
    }
  }

  targetLid(id: RealmResourceIdentifier): string {
    return join(this.targetDirectoryName, this.local(id));
  }

  target(id: RealmResourceIdentifier): RealmResourceIdentifier {
    return this.targetDirectoryPath.fileRRI(this.local(id));
  }
}

type PlanBuilderStep = (
  resolver: ListingPathResolver,
  plan: InstallPlan,
) => InstallPlan;

export class PlanBuilder {
  private steps: PlanBuilderStep[] = [];
  private log = logger('catalog:plan');
  resolver: ListingPathResolver;

  constructor(
    realmUrl: string,
    listing: Listing,
    virtualNetwork: VirtualNetwork,
  ) {
    this.resolver = new ListingPathResolver(
      realmUrl,
      listing,
      undefined,
      virtualNetwork,
    );
  }

  add(step: PlanBuilderStep): this {
    this.steps.push(step);
    return this;
  }

  addIf(condition: boolean, step: PlanBuilderStep): this {
    if (condition) {
      this.steps.push(step);
    }
    return this;
  }

  build(): InstallPlan {
    let plan: InstallPlan = this.steps.reduce(
      (plan: InstallPlan, step: PlanBuilderStep, i) => {
        this.log.debug(`=== Plan Step ${i} ===`);
        this.log.debug(JSON.stringify(plan, null, 2));
        return mergePlans(plan, step(this.resolver, plan));
      },
      new InstallPlan([], []),
    );
    this.log.debug(`=== Final Plan ===`);
    this.log.debug(JSON.stringify(plan, null, 2));
    return plan;
  }
}

// `codeRef` must already be canonical (see `canonicalRef`).
function resolveTargetCodeRef(
  codeRef: ResolvedCodeRef,
  resolver: ListingPathResolver,
): ResolvedCodeRef {
  if (isInBaseRealm(codeRef.module)) {
    return codeRef;
  }
  return {
    name: codeRef.name,
    module: resolver.target(codeRef.module),
  };
}

export function planModuleInstall(
  specs: Spec[],
  resolver: ListingPathResolver,
  virtualNetwork: VirtualNetwork,
): InstallPlan {
  if (specs.length == 0) {
    return new InstallPlan([], []);
  }
  // `spec.ref` is the canonical code ref; `spec.moduleHref` is deliberately a
  // resolved real URL for readers that cannot take an RRI (see its computeVia),
  // so it is not the right input for install planning.
  let codeRefs: ResolvedCodeRef[] = specs.flatMap((s) => {
    if (!s.ref?.module) {
      return [];
    }
    return [
      canonicalRef(
        {
          module: rri(resolveRRIReference(s.ref.module, s.id)),
          name: s.ref.name,
        },
        virtualNetwork,
      ),
    ];
  });
  let modulesCopy = codeRefs.flatMap((sourceCodeRef: ResolvedCodeRef) => {
    if (isInBaseRealm(sourceCodeRef.module)) {
      return [];
    }
    let copyMeta = {
      sourceCodeRef: fetchableRef(sourceCodeRef, virtualNetwork),
      targetCodeRef: resolveTargetCodeRef(sourceCodeRef, resolver),
    };
    return [copyMeta];
  });
  return new InstallPlan(modulesCopy, []);
}

export function planInstanceInstall(
  instances: CardDef[],
  resolver: ListingPathResolver,
  virtualNetwork: VirtualNetwork,
): InstallPlan {
  let instancesCopy: CopyInstanceMeta[] = [];
  let modulesCopy: CopyMeta[] = [];
  for (let instance of instances) {
    // Omitting the VirtualNetwork resolves in RRI space, so the adopted ref
    // arrives canonical rather than as a materialized URL.
    let adopted = resolveAdoptsFrom(instance);
    if (!adopted) {
      // Covers both halves of the contract, which the caller cannot tell apart
      // from the return value: no `adoptsFrom` at all, or one that does not
      // resolve to a concrete module.
      throw new Error(
        `Cannot resolve adoptsFrom for instance "${instance.id}"; it is missing or does not resolve to a concrete module`,
      );
    }
    let sourceCodeRef = canonicalRef(adopted, virtualNetwork);
    if (!instance.id) {
      throw new Error('Cannot install an instance that has not been saved');
    }
    let instanceId = rri(canonicalModuleKey(instance.id, virtualNetwork));
    if (isInBaseRealm(instanceId)) {
      throw new Error('Cannot install instance from base realm');
    }
    let lid = resolver.targetLid(instanceId);
    if (!isInBaseRealm(sourceCodeRef.module)) {
      let targetCodeRef = resolveTargetCodeRef(sourceCodeRef, resolver);
      modulesCopy.push({
        sourceCodeRef: fetchableRef(sourceCodeRef, virtualNetwork),
        targetCodeRef,
      });
      instancesCopy.push({
        sourceCard: instance,
        lid,
        targetCodeRef,
      });
    } else {
      instancesCopy.push({
        sourceCard: instance,
        targetCodeRef: sourceCodeRef,
        lid,
      });
    }
  }
  return new InstallPlan(modulesCopy, instancesCopy);
}

function dedupeCopyMeta(array: CopyMeta[]): CopyMeta[] {
  return uniqWith(
    array,
    (a: CopyMeta, b: CopyMeta) =>
      isEqual(a.sourceCodeRef, b.sourceCodeRef) &&
      isEqual(a.targetCodeRef, b.targetCodeRef),
  );
}
function dedupeCopyInstanceMeta(array: CopyInstanceMeta[]): CopyInstanceMeta[] {
  return uniqWith(
    array,
    (a: CopyInstanceMeta, b: CopyInstanceMeta) =>
      isEqual(a.sourceCard, b.sourceCard) &&
      isEqual(a.targetCodeRef, b.targetCodeRef) &&
      isEqual(a.lid, b.lid),
  );
}
export function mergePlans(...plans: InstallPlan[]): InstallPlan {
  return new InstallPlan(
    dedupeCopyMeta(plans.flatMap((p) => p.modulesCopy)),
    dedupeCopyInstanceMeta(plans.flatMap((p) => p.instancesCopy)),
  );
}

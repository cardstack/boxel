import { isEqual } from 'lodash-es';
import { uniqWith } from 'lodash-es';
import { kebabCase } from 'lodash-es';
import { v4 as uuidv4 } from 'uuid';
import type { Spec } from '@cardstack/base/spec';
import type { CardDef } from '@cardstack/base/card-api';
import { RealmPaths, join } from './paths.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import { resolveAdoptedCodeRef } from './code-ref.ts';
import { baseRealm, baseRealmRRI, realmURL } from './constants.ts';
import { logger } from './log.ts';
import type { LocalPath } from './paths.ts';
import { rri } from './realm-identifiers.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// Local mirror of the boxel-catalog Listing shape — that repo isn't cloned in boxel CI. (CS-11166)
export interface Listing extends CardDef {
  name?: string;
  summary?: string;
  specs: any[];
  examples: any[];
  skills: any[];
}

// A codeRef.module for a base-realm class may show up in either form: the
// literal symbolic `https://cardstack.com/base/` URL, or the base realm's
// real backing URL (e.g. `https://localhost:4201/base/skill`).
// VirtualNetwork.unresolveURL() can canonicalize either form to the
// `@cardstack/base/` RRI prefix, but only when the base realm's URL and
// realm mappings are actually registered on that VirtualNetwork instance —
// a bare VirtualNetwork (e.g. the plan-install unit test) leaves both
// forms unchanged, so the literal-URL check below is still needed.
// Without it, a base-realm module can get wrongly treated as something
// that needs to be copied into the install destination.
function isInBaseRealm(
  module: RealmResourceIdentifier,
  virtualNetwork: VirtualNetwork,
): boolean {
  if (module.startsWith(baseRealm.url)) {
    return true;
  }
  return virtualNetwork.unresolveURL(module).startsWith(baseRealmRRI);
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

    this.sourceRealmPath = new RealmPaths(sourceRealmURL, virtualNetwork);
    this.targetDirectoryPath = new RealmPaths(
      new URL(join(this.targetRealmPath.url, this.targetDirectoryName)),
      virtualNetwork,
    );
  }

  addKnownRealmURL(url: URL): void {
    let realmPath = new RealmPaths(url, this.virtualNetwork);
    if (
      realmPath.url !== this.sourceRealmPath.url &&
      !this.foreignRealmPaths.some((p) => p.url === realmPath.url)
    ) {
      this.foreignRealmPaths.push(realmPath);
    }
  }

  local(href: string): LocalPath {
    let url = new URL(href, this.sourceRealmPath.url);
    let id = rri(url.href);
    if (this.sourceRealmPath.inRealm(id)) {
      return this.sourceRealmPath.local(url);
    }
    // Try known foreign realm paths (longest URL first to handle nested realms)
    let sorted = [...this.foreignRealmPaths].sort(
      (a, b) => b.url.length - a.url.length,
    );
    for (let foreignPath of sorted) {
      if (foreignPath.inRealm(id)) {
        return foreignPath.local(url);
      }
    }
    // Fallback: strip only the origin, preserving full path for safety
    let path = decodeURI(url.pathname).replace(/^\//, '').replace(/\/+$/, '');
    return path;
  }

  targetLid(href: string): string {
    let local = this.local(href);
    return join(this.targetDirectoryName, local);
  }

  target(href: string): string {
    let local = this.local(href);
    return join(this.targetDirectoryPath.url, local);
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

function resolveTargetCodeRef(
  codeRef: ResolvedCodeRef,
  resolver: ListingPathResolver,
  virtualNetwork: VirtualNetwork,
): ResolvedCodeRef {
  if (isInBaseRealm(codeRef.module, virtualNetwork)) {
    return codeRef;
  } else {
    let moduleURL = virtualNetwork.toURL(codeRef.module);
    let targetModule = resolver.target(moduleURL.href);
    return {
      name: codeRef.name,
      module: targetModule as RealmResourceIdentifier,
    };
  }
}

export function planModuleInstall(
  specs: Spec[],
  resolver: ListingPathResolver,
  virtualNetwork: VirtualNetwork,
): InstallPlan {
  if (specs.length == 0) {
    return new InstallPlan([], []);
  }
  let codeRefs: ResolvedCodeRef[] = specs.map((s) => {
    return {
      module: s.moduleHref as RealmResourceIdentifier,
      name: s.ref.name,
    };
  });
  let modulesCopy = codeRefs.flatMap((sourceCodeRef: ResolvedCodeRef) => {
    if (isInBaseRealm(sourceCodeRef.module, virtualNetwork)) {
      return [];
    }
    let targetCodeRef = resolveTargetCodeRef(
      sourceCodeRef,
      resolver,
      virtualNetwork,
    );
    let copyMeta = {
      sourceCodeRef,
      targetCodeRef,
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
    let sourceCodeRef = resolveAdoptedCodeRef(instance, virtualNetwork);
    let lid = resolver.local(virtualNetwork.toURL(instance.id).href);
    if (isInBaseRealm(rri(instance.id), virtualNetwork)) {
      throw new Error('Cannot install instance from base realm');
    }
    if (!isInBaseRealm(sourceCodeRef.module, virtualNetwork)) {
      let targetCodeRef = resolveTargetCodeRef(
        sourceCodeRef,
        resolver,
        virtualNetwork,
      );
      modulesCopy.push({
        sourceCodeRef,
        targetCodeRef,
      });
      instancesCopy.push({
        sourceCard: instance,
        lid: resolver.targetLid(lid),
        targetCodeRef,
      });
    } else {
      instancesCopy.push({
        sourceCard: instance,
        targetCodeRef: sourceCodeRef,
        lid: resolver.targetLid(lid),
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

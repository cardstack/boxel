import { isEqual, uniqWith, kebabCase } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import type { Spec } from 'https://cardstack.com/base/spec';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import { RealmPaths, join } from './paths';
import type { ResolvedCodeRef } from './code-ref';
import { resolveAdoptedCodeRef } from './code-ref';
import { realmURL } from './constants';
import { logger } from './log';
import type { LocalPath } from './paths';

// @ts-ignore TODO: fix catalog types in runtime-common
import type { Listing } from '@cardstack/catalog/listing/listing';

const baseRealmPath = new RealmPaths(new URL('https://cardstack.com/base/'));

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

  constructor(targetRealm: string, listing: Listing, installDirId?: string) {
    this.targetRealmPath = new RealmPaths(new URL(targetRealm));

    const listingDirectoryName = kebabCase(listing.name);

    this.targetDirectoryName = generateInstallFolderName(
      listingDirectoryName,
      installDirId,
    );

    const sourceRealmURL = listing[realmURL];
    if (!sourceRealmURL) {
      throw new Error('Cannot derive realm from listing');
    }

    this.sourceRealmPath = new RealmPaths(sourceRealmURL);
    this.targetDirectoryPath = new RealmPaths(
      new URL(join(this.targetRealmPath.url, this.targetDirectoryName)),
    );
  }

  local(href: string): LocalPath {
    let local = this.sourceRealmPath.local(
      new URL(href, this.sourceRealmPath.url),
    );
    return local;
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
  private resolver: ListingPathResolver;

  constructor(realmUrl: string, listing: Listing) {
    this.resolver = new ListingPathResolver(realmUrl, listing);
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
): ResolvedCodeRef {
  if (baseRealmPath.inRealm(new URL(codeRef.module))) {
    return codeRef;
  } else {
    let targetModule = resolver.target(codeRef.module);
    return {
      name: codeRef.name,
      module: targetModule,
    };
  }
}

export function planModuleInstall(
  specs: Spec[],
  resolver: ListingPathResolver,
): InstallPlan {
  if (specs.length == 0) {
    return new InstallPlan([], []);
  }
  let codeRefs: ResolvedCodeRef[] = specs.map((s) => {
    return { module: s.moduleHref, name: s.ref.name };
  });
  let modulesCopy = codeRefs.flatMap((sourceCodeRef: ResolvedCodeRef) => {
    if (baseRealmPath.inRealm(new URL(sourceCodeRef.module))) {
      return [];
    }
    let targetCodeRef = resolveTargetCodeRef(sourceCodeRef, resolver);
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
): InstallPlan {
  let instancesCopy: CopyInstanceMeta[] = [];
  let modulesCopy: CopyMeta[] = [];
  for (let instance of instances) {
    let sourceCodeRef = resolveAdoptedCodeRef(instance);
    let lid = resolver.local(instance.id);
    if (baseRealmPath.inRealm(new URL(instance.id))) {
      throw new Error('Cannot install instance from base realm');
    }
    if (!baseRealmPath.inRealm(new URL(sourceCodeRef.module))) {
      let targetCodeRef = resolveTargetCodeRef(sourceCodeRef, resolver);
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

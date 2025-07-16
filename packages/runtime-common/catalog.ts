import { isEqual, uniqWith, kebabCase } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { Spec } from 'https://cardstack.com/base/spec';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { RealmPaths, join } from './paths';
import { ResolvedCodeRef, resolveAdoptedCodeRef } from './code-ref';
import { realmURL } from './constants';
import { logger } from './log';

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
export interface InstallPlan {
  modulesCopy: CopyMeta[];
  instancesCopy: CopyInstanceMeta[];
}

export interface FinalInstallPlan extends InstallPlan {
  modulesToInstall: CopyModuleMeta[];
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

export class InstallOptions {
  targetDirectoryName: string; //name of outer uuid  folder
  private targetRealmPath: RealmPaths;
  private sourceRealmPath: RealmPaths;
  sourceDirectoryPath: RealmPaths;

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
    let maybeSourceDirectoryPath = new RealmPaths(
      new URL(join(this.sourceRealmPath.url, listingDirectoryName)),
    );

    this.sourceDirectoryPath = allResourcesInSameDirectory(
      listing,
      maybeSourceDirectoryPath.url,
    )
      ? maybeSourceDirectoryPath
      : this.sourceRealmPath;
  }

  get sourceRealm(): string {
    return this.sourceRealmPath.url;
  }

  get targetDirectory(): string {
    return new RealmPaths(
      new URL(join(this.targetRealmPath.url, this.targetDirectoryName)),
    ).url;
  }

  get targetRealm(): string {
    return this.targetRealmPath.url;
  }
}

export function allResourcesInSameDirectory(
  listing: Listing,
  dir: string,
  ignoreBaseRealm: boolean = true,
) {
  const resourceIds: string[] = [];
  listing.specs.forEach((c: Spec) => {
    resourceIds.push(c.moduleHref);
  });
  [...listing.examples, ...listing.skills].forEach((c: CardDef) => {
    let codeRef = resolveAdoptedCodeRef(c);
    resourceIds.push(codeRef.module);
    resourceIds.push(c.id);
  });
  let sourceDirPath = new RealmPaths(new URL(dir));
  return resourceIds.every((id: string) => {
    let url = new URL(id);
    let inRealm = sourceDirPath.inRealm(url);
    let inBaseRealm = baseRealmPath.inRealm(url);
    if (ignoreBaseRealm && inBaseRealm) {
      return inBaseRealm;
    }
    return inRealm;
  });
}

function resolveTargetCodeRef(
  codeRef: ResolvedCodeRef,
  opts: InstallOptions,
): ResolvedCodeRef {
  if (baseRealmPath.inRealm(new URL(codeRef.module))) {
    return codeRef;
  } else {
    let local = resolveTargetLocal(codeRef.module, opts);
    let targetModule = join(opts.targetDirectory, local);
    return {
      name: codeRef.name,
      module: targetModule,
    };
  }
}

function resolveTargetLocal(sourceHref: string, opts: InstallOptions) {
  let local = opts.sourceDirectoryPath.local(new URL(sourceHref));
  return local;
}

type PlanBuilderStep = (opts: InstallOptions, plan: InstallPlan) => InstallPlan;

export class PlanBuilder {
  private steps: PlanBuilderStep[] = [];
  private log = logger('catalog:plan');

  constructor(private opts: InstallOptions) {}

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

  build(): FinalInstallPlan {
    let accumulatedPlan: InstallPlan = this.steps.reduce(
      (plan: InstallPlan, step: PlanBuilderStep, i) => {
        this.log.debug(`=== Plan Step ${i} ===`);
        this.log.debug(JSON.stringify(plan, null, 2));
        return mergePlans(plan, step(this.opts, plan));
      },
      {
        modulesCopy: [],
        instancesCopy: [],
      },
    );
    const finalPlan: FinalInstallPlan = {
      ...accumulatedPlan,
      modulesToInstall: modulesToInstall(accumulatedPlan),
    };
    this.log.debug(`=== Final Plan ===`);
    this.log.debug(JSON.stringify(finalPlan, null, 2));
    return finalPlan;
  }
}

export function planModuleInstall(
  specs: Spec[],
  opts: InstallOptions,
): InstallPlan {
  if (specs.length == 0) {
    return {
      modulesCopy: [],
      instancesCopy: [],
    };
  }
  let codeRefs: ResolvedCodeRef[] = specs.map((s) => {
    return { module: s.moduleHref, name: s.ref.name };
  });
  let modulesCopy = codeRefs.flatMap((sourceCodeRef: ResolvedCodeRef) => {
    if (baseRealmPath.inRealm(new URL(sourceCodeRef.module))) {
      return [];
    }
    let targetCodeRef = resolveTargetCodeRef(sourceCodeRef, opts);
    let copyMeta = {
      sourceCodeRef,
      targetCodeRef,
    };
    return [copyMeta];
  });
  return {
    modulesCopy,
    instancesCopy: [],
  };
}

export function planInstanceInstall(
  instances: CardDef[],
  opts: InstallOptions,
): InstallPlan {
  let copyInstanceMeta: CopyInstanceMeta[] = [];
  let copySourceMeta: CopyMeta[] = [];
  for (let instance of instances) {
    let sourceCodeRef = resolveAdoptedCodeRef(instance);
    let lid = resolveTargetLocal(instance.id, opts);
    if (baseRealmPath.inRealm(new URL(instance.id))) {
      throw new Error('Cannot install instance from base realm');
    }
    if (!baseRealmPath.inRealm(new URL(sourceCodeRef.module))) {
      let targetCodeRef = resolveTargetCodeRef(sourceCodeRef, opts);
      copySourceMeta.push({
        sourceCodeRef,
        targetCodeRef,
      });
      copyInstanceMeta.push({
        sourceCard: instance,
        lid: join(opts.targetDirectoryName, lid),
        targetCodeRef,
      });
    } else {
      copyInstanceMeta.push({
        sourceCard: instance,
        targetCodeRef: sourceCodeRef,
        lid: join(opts.targetDirectoryName, lid),
      });
    }
  }
  return {
    modulesCopy: copySourceMeta,
    instancesCopy: copyInstanceMeta,
  };
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
  return {
    modulesCopy: dedupeCopyMeta(plans.flatMap((p) => p.modulesCopy)),
    instancesCopy: dedupeCopyInstanceMeta(
      plans.flatMap((p) => p.instancesCopy),
    ),
  };
}

export function modulesToInstall(plan: InstallPlan): CopyModuleMeta[] {
  // Deduplicate based on source and target module paths
  const uniqueModules = plan.modulesCopy.reduce((acc, copyMeta) => {
    const key = `${copyMeta.sourceCodeRef.module}-${copyMeta.targetCodeRef.module}`;
    if (!acc.has(key)) {
      acc.set(key, {
        sourceModule: copyMeta.sourceCodeRef.module,
        targetModule: copyMeta.targetCodeRef.module,
      });
    }
    return acc;
  }, new Map<string, CopyModuleMeta>());

  return Array.from(uniqueModules.values());
}

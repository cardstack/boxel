import {
  moduleFrom,
  type LooseCardResource,
  type Loader,
} from '@cardstack/runtime-common';

export function directModuleDeps(
  resource: LooseCardResource,
  instanceURL: URL,
): string[] {
  let result = [
    // we always depend on our own adoptsFrom
    new URL(moduleFrom(resource.meta.adoptsFrom), instanceURL).href,
  ];

  // we might also depend on any polymorphic types in meta.fields
  if (resource.meta.fields) {
    for (let fieldMeta of Object.values(resource.meta.fields)) {
      if (Array.isArray(fieldMeta)) {
        for (let meta of fieldMeta) {
          if (meta.adoptsFrom) {
            result.push(new URL(moduleFrom(meta.adoptsFrom), instanceURL).href);
          }
        }
      } else {
        if (fieldMeta.adoptsFrom) {
          result.push(
            new URL(moduleFrom(fieldMeta.adoptsFrom), instanceURL).href,
          );
        }
      }
    }
  }
  return result;
}

export async function recursiveModuleDeps(
  directDeps: string[],
  loader: Loader,
) {
  return new Set([
    ...directDeps,
    ...(
      await Promise.all(
        directDeps.map((moduleDep) => loader.getConsumedModules(moduleDep)),
      )
    ).flat(),
  ]);
}

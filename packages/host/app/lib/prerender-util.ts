import {
  visitModuleDeps,
  resolveCardReference,
  type LooseCardResource,
  type Loader,
} from '@cardstack/runtime-common';

export function directModuleDeps(
  resource: LooseCardResource,
  instanceURL: URL,
): string[] {
  let result: string[] = [];
  visitModuleDeps(resource, (moduleURL) => {
    result.push(resolveCardReference(moduleURL, instanceURL));
  });
  return result;
}

export async function transitiveModuleDeps(
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

import {
  visitModuleDeps,
  rri,
  type LooseCardResource,
  type Loader,
  type VirtualNetwork,
} from '@cardstack/runtime-common';

export function directModuleDeps(
  resource: LooseCardResource,
  instanceURL: URL,
  virtualNetwork: VirtualNetwork,
): string[] {
  let result: string[] = [];
  visitModuleDeps(resource, (moduleURL) => {
    result.push(virtualNetwork.resolveRRI(moduleURL, rri(instanceURL.href)));
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

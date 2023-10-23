import flatMap from 'lodash/flatMap';

import {
  hasExecutableExtension,
  type Relationship,
  type Loader,
} from '@cardstack/runtime-common';

export async function getModulesInRealm(
  loader: Loader,
  realmURL: string,
  url: string = realmURL,
): Promise<string[]> {
  let response: Response | undefined;
  response = await loader.fetch(url, {
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!response.ok) {
    // the server may a moment to become ready do be tolerant of errors at boot
    console.log(
      `Could not get directory listing ${url}, status ${response.status}: ${
        response.statusText
      } - ${await response.text()}`,
    );
    return [];
  }
  let {
    data: { relationships: _relationships },
  } = await response.json();
  let relationships = _relationships as Record<string, Relationship>;
  let modules: string[] = flatMap(
    Object.entries(relationships),
    ([name, info]) =>
      info.meta!.kind === 'file' && hasExecutableExtension(name)
        ? [`${url}${name}`]
        : [],
  );
  let nestedDirs = flatMap(Object.values(relationships), (rel) =>
    rel.meta!.kind === 'directory' ? [rel.links.related] : [],
  ).filter(Boolean) as string[];
  let nestedResults: string[] = [];
  for (let dir of nestedDirs) {
    nestedResults.push(...(await getModulesInRealm(loader, realmURL, dir)));
  }
  return [...modules, ...nestedResults];
}

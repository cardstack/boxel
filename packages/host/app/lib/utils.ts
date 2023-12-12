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

export function stripFileExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

// Used to generate a color for the profile avatar
// Copied from https://github.com/mui/material-ui/issues/12700
export function stringToColor(string: string | null) {
  if (!string) {
    return 'transparent';
  }

  let hash = 0;
  let i;

  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.substr(-2);
  }

  return color;
}

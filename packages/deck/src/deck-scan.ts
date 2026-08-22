import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_JSON_PATH } from './package-json.ts';

// Finding the decks in a depot. The rule is the layout itself: a directory
// two levels down holding a package.json IS a deck, addressed at
// `/<depot>/<publisher>/<package>/`. Nothing registers; nothing is
// configured. The depot-root importmap.json is the lock, not a deck —
// discovery never looks at depth 0.

export interface DeckRef {
  publisher: string;
  package: string;
  // `<publisher>/<package>` — the store name and the log path both use it.
  name: string;
  dir: string;
}

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function discoverDecks(depotDir: string): Promise<DeckRef[]> {
  let decks: DeckRef[] = [];
  for (let publisher of await directoriesIn(depotDir)) {
    for (let name of await directoriesIn(join(depotDir, publisher))) {
      let dir = join(depotDir, publisher, name);
      if (!(await isFile(join(dir, PACKAGE_JSON_PATH)))) {
        continue;
      }
      decks.push({
        publisher,
        package: name,
        name: `${publisher}/${name}`,
        dir,
      });
    }
  }
  return decks.sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function directoriesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SEGMENT.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

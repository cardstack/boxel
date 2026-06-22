import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Walk up from `__dirname` until we find the `@cardstack/boxel-cli`
 * package.json. The single-file esbuild bundle places `__dirname` at
 * `boxel-cli/dist`; running from source (e.g. under vitest) places it
 * inside `src/...`. Anchoring to the package.json keeps every downstream
 * path stable regardless of which entry mode is active.
 */
export function findBoxelCliRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    let candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        let parsed = JSON.parse(readFileSync(candidate, 'utf8'));
        if (parsed?.name === '@cardstack/boxel-cli') {
          return dir;
        }
      } catch {
        // ignore unparseable package.json and keep walking
      }
    }
    let parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        'Could not locate the @cardstack/boxel-cli package root walking up from ' +
          startDir,
      );
    }
    dir = parent;
  }
}

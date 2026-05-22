/**
 * Populate `packages/boxel-cli/bundled-realms/` from `packages/base/` and
 * `packages/skills-realm/contents/` so a published `@cardstack/boxel-cli`
 * install can run `boxel test` without a realm-server on PATH (CS-11164).
 *
 * The CLI's in-process test-page server (see `startTestPageServer`
 * in `src/commands/test.ts`) mounts these directories at `/base/`
 * and `/skills/` and transpiles `.gts` / `.ts` on demand. Cards that
 * import `https://cardstack.com/base/card-api` resolve through the
 * host bundle's URL-mapping to that mount point, so the realm-server
 * never gets a request.
 *
 * The source dirs are small (~3MB combined) so we copy everything except
 * `node_modules/` and dot-files. Pre-transpiling at build time would
 * couple the bundled output to a specific babel/content-tag version;
 * on-demand transpile keeps the bundle plain source.
 *
 * Run order: this is invoked as part of `pnpm build` for boxel-cli;
 * no upstream host build is required.
 */

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(__dirname, '..');
const MONOREPO_PACKAGES = resolve(PACKAGE_ROOT, '..');
const OUT_DIR = join(PACKAGE_ROOT, 'bundled-realms');

interface RealmSource {
  name: string;
  src: string;
}

const REALMS: RealmSource[] = [
  { name: 'base', src: join(MONOREPO_PACKAGES, 'base') },
  {
    name: 'skills',
    src: join(MONOREPO_PACKAGES, 'skills-realm', 'contents'),
  },
];

function dirSize(dir: string): number {
  let total = 0;
  let walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (let entry of entries) {
      let full = join(current, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}

function shouldSkip(name: string): boolean {
  // node_modules pulled in via workspace symlinks aren't part of the realm
  // contents; dot-files (.gitignore, .DS_Store, .boxel-sync.json, ...) are
  // workspace metadata that the realm-server already ignores.
  return name === 'node_modules' || name.startsWith('.');
}

function main(): void {
  console.log('Building bundled-realms for boxel-cli (CS-11164)...');
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (let realm of REALMS) {
    try {
      if (!statSync(realm.src).isDirectory()) {
        console.error(
          `Source for "${realm.name}" is not a directory: ${realm.src}`,
        );
        process.exit(1);
      }
    } catch {
      console.error(
        `Missing realm source for "${realm.name}" at ${realm.src}. ` +
          'Run from inside the monorepo.',
      );
      process.exit(1);
    }
    let dst = join(OUT_DIR, realm.name);
    cpSync(realm.src, dst, {
      recursive: true,
      filter: (src) => !shouldSkip(basename(src)),
    });
  }

  let size = dirSize(OUT_DIR);
  console.log(`Bundled-realms: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

main();

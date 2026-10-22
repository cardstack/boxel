/**
 * Populate `packages/boxel-cli/bundled-realms/` from `packages/base/`,
 * `packages/skills-realm/contents/` and `packages/pretui/` so a published
 * `@cardstack/boxel-cli` install can run `boxel test` without a realm-server
 * on PATH.
 *
 * The CLI's in-process test-page server (see `startTestPageServer`
 * in `src/commands/test.ts`) mounts these directories at `/base/`,
 * `/skills/` and `/pretui/` and transpiles `.gts` / `.ts` on demand. Cards that
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

import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const MONOREPO_PACKAGES = resolve(PACKAGE_ROOT, '..');
const OUT_DIR = join(PACKAGE_ROOT, 'bundled-realms');

interface RealmSource {
  name: string;
  src: string;
  /**
   * If `true`, fail when the source is missing; if `false`, warn and
   * skip. `packages/skills-realm/contents/` is gitignored and only
   * populated via `pnpm --filter @cardstack/skills-realm skills:setup`
   * (which clones the external `cardstack/boxel-skills` repo). CI
   * runners and minimal monorepo checkouts don't have it; card tests
   * don't actually load anything from `/skills/` at runtime (it's for
   * the AI assistant scaffolding), so shipping without it is fine.
   */
  required: boolean;
  /**
   * A file in the source listing what the realm leaves out, one pattern per
   * line. It is the list the realm's deployment reads as rsync filter rules,
   * so the bundled copy holds what the deployed realm holds.
   */
  ignoreFile?: string;
}

const REALMS: RealmSource[] = [
  { name: 'base', src: join(MONOREPO_PACKAGES, 'base'), required: true },
  {
    name: 'skills',
    src: join(MONOREPO_PACKAGES, 'skills-realm', 'contents'),
    required: false,
  },
  {
    name: 'pretui',
    src: join(MONOREPO_PACKAGES, 'pretui'),
    required: true,
    ignoreFile: '.boxelignore',
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

// The patterns an ignore file may use, read as rsync reads them: `name/`
// leaves out every directory of that name, and any other pattern leaves out
// every file or directory whose name it matches, with `*` matching within a
// name. Anything else is refused rather than read some other way.
function readIgnorePatterns(file: string): ((path: string) => boolean)[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((pattern) => {
      let dirOnly = pattern.endsWith('/');
      let name = dirOnly ? pattern.slice(0, -1) : pattern;
      if (name === '' || /[/!?[\]\\]/.test(name)) {
        throw new Error(
          `Unsupported pattern "${pattern}" in ${file}: build-realms reads ` +
            'only `name`, `*.ext`-style and `dir/` patterns.',
        );
      }
      let regex = new RegExp(
        '^' +
          name
            .split('*')
            .map((part) => part.replace(/[.+^${}()|]/g, '\\$&'))
            .join('[^/]*') +
          '$',
      );
      return (path: string) => {
        if (!regex.test(basename(path))) return false;
        return !dirOnly || statSync(path).isDirectory();
      };
    });
}

function main(): void {
  console.log('Building bundled-realms for boxel-cli (CS-11164)...');
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (let realm of REALMS) {
    let present = false;
    try {
      present = statSync(realm.src).isDirectory();
    } catch {
      // not present
    }
    if (!present) {
      if (realm.required) {
        console.error(
          `Missing required realm source for "${realm.name}" at ${realm.src}. ` +
            'Run from inside the monorepo.',
        );
        process.exit(1);
      } else {
        console.log(
          `  skipping "${realm.name}" — source missing at ${realm.src} ` +
            '(non-required realm; usually packages/skills-realm/contents ' +
            'not populated)',
        );
        continue;
      }
    }
    let ignored = realm.ignoreFile
      ? readIgnorePatterns(join(realm.src, realm.ignoreFile))
      : [];
    let dst = join(OUT_DIR, realm.name);
    cpSync(realm.src, dst, {
      recursive: true,
      filter: (src) =>
        !shouldSkip(basename(src)) && !ignored.some((ignores) => ignores(src)),
    });
  }

  let size = dirSize(OUT_DIR);
  console.log(`Bundled-realms: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

main();

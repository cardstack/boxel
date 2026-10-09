/**
 * Builds the film app into the gallery realm, at
 * `packages/choreo-gallery/realm/film-app/`. The build is not committed:
 * `pnpm push` in choreo-gallery runs this before it pushes the realm.
 *
 *   pnpm build:realm
 *
 * The realm compiles every `.js` file it serves as a card module, which would
 * break a browser bundle, and serves `.mjs` verbatim with a JavaScript content
 * type. So every script in the build is renamed `.mjs`, and every reference to
 * it in the build's HTML, scripts and styles is renamed with it.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const target = resolve(packageRoot, '../choreo-gallery/realm/film-app');

const scratch = mkdtempSync(join(tmpdir(), 'choreo-film-app-'));
try {
  const out = join(scratch, 'film-app');
  const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--outDir', out], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (build.error || build.status !== 0) {
    throw new Error(
      build.error?.message ?? `vite build exited ${build.status}`,
    );
  }
  renameScripts(out);
  refuseLocalPaths(out);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(out, target, { recursive: true });
  console.log(`✓ built the film app into ${relative(process.cwd(), target)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function files(root) {
  return readdirSync(root, { recursive: true })
    .map((name) => String(name))
    .filter((name) => statSync(join(root, name)).isFile())
    .sort();
}

function renameScripts(root) {
  const all = files(root);
  const scripts = all.filter((name) => name.endsWith('.js'));
  const names = scripts.map((name) => name.split('/').pop());
  const rewrite = (text) =>
    names.reduce(
      (source, name) => source.replaceAll(name, name.replace(/\.js$/, '.mjs')),
      text,
    );
  for (const name of all.filter((file) => /\.(html|js|css)$/.test(file))) {
    const path = join(root, name);
    writeFileSync(path, rewrite(readFileSync(path, 'utf8')));
  }
  for (const name of scripts) {
    renameSync(join(root, name), join(root, name.replace(/\.js$/, '.mjs')));
  }
}

/**
 * The realm publishes the build, so it must not carry the path of the
 * checkout that built it (vite.config.mjs strips it from every chunk).
 */
function refuseLocalPaths(root) {
  const leaking = files(root).filter((name) =>
    readFileSync(join(root, name), 'utf8').includes(repoRoot),
  );
  if (leaking.length) {
    throw new Error(
      `The build names this checkout's path (${repoRoot}) in: ${leaking.join(', ')}`,
    );
  }
}

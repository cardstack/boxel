/**
 * Builds the film app into the gallery realm, at
 * `packages/choreo-gallery/realm/film-app/`, where it is committed.
 *
 *   pnpm build:realm   # rebuild and replace the realm's copy
 *   pnpm lint:realm    # rebuild into a scratch directory; exit 1 if it differs
 *
 * The realm compiles every `.js` file it serves as a card module, which would
 * break a browser bundle, and serves `.mjs` verbatim with a JavaScript content
 * type. So every script in the build is renamed `.mjs`, and every reference to
 * it in the build's HTML, scripts and styles is renamed with it.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
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
const target = resolve(packageRoot, '../choreo-gallery/realm/film-app');
const check = process.argv.includes('--check');

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

  if (check) {
    const differences = compare(out, target);
    if (differences.length) {
      console.error(
        `The film app in the gallery realm is not the build of its sources:\n` +
          differences.map((line) => `  ${line}`).join('\n') +
          `\nRun \`pnpm --filter choreo-film-app build:realm\` and commit the result.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`✓ ${relative(process.cwd(), target)} matches its sources`);
    }
  } else {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(out, target, { recursive: true });
    console.log(`✓ built the film app into ${relative(process.cwd(), target)}`);
  }
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

function compare(built, committed) {
  if (!existsSync(committed)) {
    return [`${relative(process.cwd(), committed)} is missing`];
  }
  const expected = files(built);
  const actual = files(committed);
  const differences = [];
  for (const name of expected) {
    if (!actual.includes(name)) {
      differences.push(`missing ${name}`);
    } else if (
      !readFileSync(join(built, name)).equals(
        readFileSync(join(committed, name)),
      )
    ) {
      differences.push(`differs ${name}`);
    }
  }
  for (const name of actual) {
    if (!expected.includes(name)) {
      differences.push(`unexpected ${name}`);
    }
  }
  return differences;
}

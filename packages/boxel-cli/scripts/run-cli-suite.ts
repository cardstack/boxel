/**
 * Run the boxel-cli test suite against the CLI *as an end user installs
 * it* — not against `src/`. This is the piece the in-process,
 * function-call tests could never cover: a `boxel parse` failure that
 * only surfaces under npm's hoisted `node_modules` layout can ship
 * despite a fully green suite.
 *
 * It installs the CLI into a throwaway directory *outside* the monorepo,
 * points `BOXEL_CLI_BIN` at the installed JS entry, and execs a test
 * command that inherits that env. `tests/helpers/run-boxel.ts` reads
 * `BOXEL_CLI_BIN`, so every `runBoxel(...)` call in the suite drives the
 * installed binary. The suite itself is identical across contexts — only
 * the thing executed changes.
 *
 *   node scripts/run-cli-suite.ts --source tarball -- <test command…>
 *   node scripts/run-cli-suite.ts --source published --version 0.5.0-unstable.4 -- <test command…>
 *
 * Sources:
 *   --source tarball    `pnpm pack` the current build, `npm install` the
 *                        tarball. pnpm (not npm) packs because it rewrites
 *                        `catalog:` / `workspace:*` specifiers to real
 *                        versions exactly as `pnpm publish` would; npm
 *                        would leave them literal and the install would
 *                        fail. The tarball's own deps then install under
 *                        npm's hoisting — the layout that breaks parse.
 *                        Requires a prior `pnpm build` so dist/ and
 *                        bundled-* exist to pack.
 *   --source published  `npm install @cardstack/boxel-cli@<version>` from
 *                        the registry, polling for propagation. Verifies
 *                        the actual shipped artifact post-release.
 *
 * Everything after `--` is the test command run with `BOXEL_CLI_BIN` set
 * (e.g. `pnpm test:integration`, or `vitest run tests/integration/parse.test.ts`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const PKG_NAME = '@cardstack/boxel-cli';

interface Args {
  source: 'tarball' | 'published';
  version: string;
  testCommand: string[];
}

function parseArgs(argv: string[]): Args {
  let source: string | undefined;
  let version = 'latest';
  let testCommand: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--') {
      testCommand = argv.slice(i + 1);
      break;
    } else if (arg === '--source') {
      source = argv[++i];
    } else if (arg === '--version') {
      version = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (source !== 'tarball' && source !== 'published') {
    throw new Error(
      `--source must be 'tarball' or 'published' (got ${source})`,
    );
  }
  if (testCommand.length === 0) {
    throw new Error('No test command given. Pass it after `--`.');
  }
  return { source, version, testCommand };
}

/**
 * `pnpm pack` the current package into `destDir` and return the tarball
 * path. pnpm resolves `catalog:` / `workspace:*` specifiers in the
 * packed package.json, matching what `pnpm publish` ships.
 */
function packTarball(destDir: string): string {
  execFileSync('pnpm', ['pack', '--pack-destination', destDir], {
    cwd: PKG_ROOT,
    stdio: 'inherit',
  });
  let tgz = readdirSync(destDir).find((f) => f.endsWith('.tgz'));
  if (!tgz) {
    throw new Error(`pnpm pack produced no .tgz in ${destDir}`);
  }
  return join(destDir, tgz);
}

/**
 * Poll `npm view` until `version` (a concrete version or a dist-tag) is
 * resolvable, absorbing post-publish registry propagation delay.
 */
function waitForPublishedVersion(version: string): void {
  let deadline = Date.now() + 180_000;
  let attempt = 0;
  for (;;) {
    let result = spawnSync(
      'npm',
      ['view', `${PKG_NAME}@${version}`, 'version'],
      { encoding: 'utf8' },
    );
    if (result.status === 0 && result.stdout.trim()) {
      console.log(`Resolved ${PKG_NAME}@${version} → ${result.stdout.trim()}`);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${PKG_NAME}@${version} not resolvable after 180s. Last npm error:\n${result.stderr}`,
      );
    }
    let delay = Math.min(15_000, 2_000 * ++attempt);
    console.log(
      `Waiting for ${PKG_NAME}@${version} to propagate (${attempt})…`,
    );
    execFileSync('sleep', [String(delay / 1000)]);
  }
}

/**
 * Create a clean install dir outside the monorepo and `npm install` the
 * given spec (a tarball path or a registry spec). npm — not pnpm — so
 * the CLI's dependencies land in the hoisted layout a real user gets.
 */
function npmInstall(spec: string): { installDir: string; entry: string } {
  let installDir = mkdtempSync(join(tmpdir(), 'boxel-cli-suite-'));
  // A minimal package.json so `npm install` treats this as a project
  // root and hoists deps into `installDir/node_modules`.
  writeFileSync(
    join(installDir, 'package.json'),
    JSON.stringify(
      { name: 'boxel-cli-suite-host', version: '0.0.0', private: true },
      null,
      2,
    ) + '\n',
  );
  execFileSync(
    'npm',
    ['install', spec, '--no-audit', '--no-fund', '--loglevel', 'error'],
    { cwd: installDir, stdio: 'inherit' },
  );
  let entry = join(installDir, 'node_modules', PKG_NAME, 'dist', 'index.js');
  if (!existsSync(entry)) {
    throw new Error(`Installed CLI entry not found at ${entry}`);
  }
  return { installDir, entry };
}

function main(): void {
  let { source, version, testCommand } = parseArgs(process.argv.slice(2));

  let workDir = mkdtempSync(join(tmpdir(), 'boxel-cli-pack-'));
  let cleanupDirs = [workDir];
  try {
    let spec: string;
    if (source === 'tarball') {
      spec = packTarball(workDir);
    } else {
      waitForPublishedVersion(version);
      spec = `${PKG_NAME}@${version}`;
    }

    let { installDir, entry } = npmInstall(spec);
    cleanupDirs.push(installDir);
    console.log(
      `\nBOXEL_CLI_BIN=${entry}\nRunning: ${testCommand.join(' ')}\n`,
    );

    let [cmd, ...cmdArgs] = testCommand;
    let result = spawnSync(cmd, cmdArgs, {
      cwd: PKG_ROOT,
      stdio: 'inherit',
      env: { ...process.env, BOXEL_CLI_BIN: entry },
    });
    process.exitCode = result.status ?? 1;
  } finally {
    for (let dir of cleanupDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

main();

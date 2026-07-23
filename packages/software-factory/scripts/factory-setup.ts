// This should be first
import '../src/setup-logger.ts';

// Idempotent bootstrap for `pnpm factory:go` on a fresh checkout (CS-12186).
// Builds the boxel-cli API bundle, builds the host app in dev mode (so the
// test harness has its `dist/tests/index.html` entry), and downloads the
// Playwright Chromium headless-shell binary — skipping any step whose artifact
// is already present. Node itself can't be installed for you, so a too-old Node
// is reported as an error rather than a build step.
//
// Pass --force to rebuild/reinstall everything regardless of what's present.

import { spawnSync } from 'node:child_process';

import { logger } from '../src/logger.ts';
import {
  MIN_NODE_MAJOR,
  PINNED_NODE,
  boxelCliApiJsExists,
  hostTestHarnessExists,
  isNodeVersionOk,
  packageRoot,
  playwrightHeadlessShellPresent,
  repoRoot,
} from '../src/preflight.ts';

let log = logger('factory-setup');

function run(label: string, cmd: string, args: string[], cwd: string): void {
  log.info(`▶ ${label}`);
  log.info(`  ${cmd} ${args.join(' ')}`);
  let result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    // pnpm/npx resolve through the shell on Windows.
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    log.error(`✗ ${label} failed (exit ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
}

function main(): void {
  let force = process.argv.slice(2).includes('--force');
  let root = repoRoot();

  // Node can't be provisioned by a build step — fail early with guidance.
  if (!isNodeVersionOk()) {
    log.error(
      `Node ${process.versions.node} detected, but the factory requires Node >= ${MIN_NODE_MAJOR}.`,
    );
    log.error(
      `Install it (the repo pins ${PINNED_NODE} via .nvmrc / devEngines), then re-run pnpm factory:setup.`,
    );
    process.exit(1);
  }

  if (force || !boxelCliApiJsExists()) {
    run(
      'Build boxel-cli API bundle (dist/api.js)',
      'pnpm',
      ['--filter', '@cardstack/boxel-cli', 'build:api'],
      root,
    );
  } else {
    log.info('✓ boxel-cli dist/api.js present — skipping');
  }

  if (force || !hostTestHarnessExists()) {
    run(
      'Build host app (dev mode, with test entries)',
      'pnpm',
      ['--filter', '@cardstack/host', 'build'],
      root,
    );
  } else {
    log.info('✓ host dist/tests/index.html present — skipping');
  }

  if (force || !playwrightHeadlessShellPresent()) {
    // Run from this package (its node_modules has @playwright/test).
    run(
      'Install Playwright Chromium (headless shell)',
      'pnpm',
      ['exec', 'playwright', 'install', 'chromium-headless-shell'],
      packageRoot(),
    );
  } else {
    log.info('✓ Playwright chromium-headless-shell present — skipping');
  }

  log.info('✓ factory:setup complete.');
  log.info(
    '  Run: pnpm factory:go --brief-url <url> --target-realm <url> --debug',
  );
}

main();

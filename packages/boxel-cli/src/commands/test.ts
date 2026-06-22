import type { Command } from 'commander';
import { resolve } from 'node:path';

import { FG_RED, FG_GREEN, DIM, RESET } from '../lib/colors.ts';
import { cliLog } from '../lib/cli-log.ts';
import {
  runTestsForRealm,
  runTestsLocally,
  type RunTestsResult,
} from '../lib/test-engine.ts';

interface TestCliOptions {
  realm?: string;
  hostAppUrl?: string;
  hostDistDir?: string;
  debug?: boolean;
  json?: boolean;
}

export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description(
      'Run every `*.test.gts` file in a workspace directory in a headless Chromium driven against the host app. Defaults to serving cards from the local workspace (cwd or [path]) via an in-process transpiling server; pass `--realm <url>` to test cards already on a remote realm instead.',
    )
    .argument(
      '[path]',
      'Local workspace directory to test (defaults to cwd). Ignored when --realm is set.',
    )
    .option(
      '--realm <realm-url>',
      'Test against a remote realm URL instead of the local workspace. Modules are fetched from the realm-server.',
    )
    .option(
      '--host-app-url <url>',
      "Host app URL (compat proxy). Defaults to the local module server in local mode, or the active profile's realm-server URL in --realm mode.",
    )
    .option(
      '--host-dist-dir <path>',
      'Override the host app dist directory used to build the test page.',
    )
    .option('--debug', 'Stream browser console output to stderr')
    .option('--json', 'Output structured JSON result')
    .action(async (pathArg: string | undefined, opts: TestCliOptions) => {
      let result: RunTestsResult;
      try {
        if (opts.realm) {
          result = await runTestsForRealm(opts.realm, {
            ...(opts.hostAppUrl ? { hostAppUrl: opts.hostAppUrl } : {}),
            ...(opts.hostDistDir ? { hostDistDir: opts.hostDistDir } : {}),
            ...(opts.debug ? { debug: true } : {}),
          });
        } else {
          let workspaceDir = resolve(pathArg ?? process.cwd());
          result = await runTestsLocally({
            workspaceDir,
            ...(opts.hostDistDir ? { hostDistDir: opts.hostDistDir } : {}),
            ...(opts.debug ? { debug: true } : {}),
          });
        }
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (result.status !== 'passed') {
          process.exit(1);
        }
        return;
      }

      if (result.errorMessage) {
        console.error(`${FG_RED}Error:${RESET} ${result.errorMessage}`);
      }

      if (result.testFiles.length === 0) {
        console.log(`${DIM}No .test.gts files found in the realm.${RESET}`);
        if (result.status !== 'passed') {
          process.exit(1);
        }
        return;
      }

      if (result.failures.length > 0) {
        for (let f of result.failures) {
          console.log(
            `\n${FG_RED}FAIL${RESET} ${DIM}${f.module}${RESET} › ${f.testName}`,
          );
          console.log(`  ${f.message}`);
          if (f.stackTrace) {
            console.log(
              `  ${DIM}${f.stackTrace.split('\n').slice(0, 3).join('\n  ')}${RESET}`,
            );
          }
        }
      }

      let statusColor =
        result.status === 'passed'
          ? FG_GREEN
          : result.status === 'failed'
            ? FG_RED
            : FG_RED;
      console.log(
        `\n${statusColor}${result.status}${RESET} ${DIM}—${RESET} ${result.passedCount} passed, ${result.failedCount} failed${result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ''} ${DIM}(${result.durationMs}ms across ${result.testFiles.length} file(s))${RESET}`,
      );

      if (result.status !== 'passed') {
        process.exit(1);
      }
    });
}

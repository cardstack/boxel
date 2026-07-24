// This should be first
import '../setup-logger.ts';

import { configureLogger, logger, setLogTimestampsEnabled } from '../logger.ts';
import {
  formatMissingPrerequisites,
  missingPrerequisites,
} from '../preflight.ts';

let log = logger('factory-entrypoint');

function wantsHelp(argv: string[]): boolean {
  let normalized = argv[0] === '--' ? argv.slice(1) : argv;
  return normalized.includes('--help');
}

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  let helpRequested = wantsHelp(argv);

  // Preflight BEFORE importing anything from @cardstack/boxel-cli. That import
  // resolves to boxel-cli/dist/api.js — one of the build artifacts a fresh
  // checkout is missing (CS-12186) — so a missing prerequisite would otherwise
  // crash at module load with an opaque ERR_MODULE_NOT_FOUND before any of our
  // code runs. Report every missing prerequisite at once and point at
  // `pnpm factory:setup`. Skipped for --help so usage stays available on an
  // otherwise-provisioned checkout.
  if (!helpRequested) {
    let missing = missingPrerequisites();
    if (missing.length > 0) {
      log.error(formatMissingPrerequisites(missing));
      process.exitCode = 1;
      return;
    }
  }

  // Deferred imports: only load boxel-cli (and the rest of the entrypoint,
  // which imports it transitively) once preflight has confirmed dist/api.js
  // exists.
  let entrypoint;
  let briefModule;
  let cli;
  try {
    [entrypoint, briefModule, cli] = await Promise.all([
      import('../factory-entrypoint.ts'),
      import('../factory-brief.ts'),
      import('@cardstack/boxel-cli/api'),
    ]);
  } catch (error) {
    // The only expected failure here is --help on a checkout that hasn't built
    // dist/api.js yet (preflight is skipped for --help). Re-run the check so
    // the user still gets the actionable list instead of a raw module error.
    let missing = missingPrerequisites();
    if (missing.length > 0) {
      log.error(formatMissingPrerequisites(missing));
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let {
    FactoryEntrypointUsageError,
    getFactoryEntrypointUsage,
    parseFactoryEntrypointArgs,
    runFactoryEntrypoint,
    wantsFactoryEntrypointHelp,
  } = entrypoint;
  let { FactoryBriefError } = briefModule;
  let { BoxelCLIClient } = cli;

  try {
    if (wantsFactoryEntrypointHelp(argv)) {
      console.log(getFactoryEntrypointUsage());
      return;
    }

    let options = parseFactoryEntrypointArgs(argv);

    // --debug raises the log level so debug-gated lines (e.g. full
    // run-command response bodies) surface, unless the caller has already
    // pinned a level via LOG_LEVELS. It also turns on the timing
    // instrumentation (per-line timestamps + per-phase/summary durations),
    // which is otherwise off so normal runs stay clean.
    if (options.debug) {
      setLogTimestampsEnabled(true);
      if (!process.env.LOG_LEVELS) {
        configureLogger('*=debug');
      }
    }

    await BoxelCLIClient.ensureProfile({
      realmServerUrl: options.realmServerUrl ?? undefined,
    });

    log.info(`brief=${options.briefUrl}`);
    log.info('Starting seed issue + issue-driven loop...');

    let summary = await runFactoryEntrypoint(options);

    if (summary.issueLoop) {
      log.info(
        `Issue loop complete: outcome=${summary.issueLoop.outcome} ` +
          `outerCycles=${summary.issueLoop.outerCycles} ` +
          `issues=${summary.issueLoop.issueResults.length}`,
      );
      for (let ir of summary.issueLoop.issueResults) {
        log.info(
          `  ${ir.issueId}: ${ir.exitReason} (${ir.innerIterations} iterations, ${ir.toolCallCount} tool calls)`,
        );
      }
      if (summary.issueLoop.outcome === 'all_issues_done') {
        log.info('All issues done.');
      } else {
        log.info(`Exiting with outcome=${summary.issueLoop.outcome}`);
      }
    }

    // Reflect the run outcome in the exit code so CI / callers can detect
    // failures without parsing logs. `completed` is the only success state;
    // `ready` means the entrypoint returned before the loop ran, which we
    // treat as a failed invocation.
    if (summary.result.status !== 'completed') {
      process.exitCode = 1;
    }

    if (options.debug) {
      await writeToStdout(JSON.stringify(summary, null, 2) + '\n');
    }
  } catch (error: unknown) {
    if (error instanceof FactoryEntrypointUsageError) {
      log.error(error.message);
      log.error('');
      log.error(getFactoryEntrypointUsage());
    } else if (error instanceof FactoryBriefError) {
      log.error(error.message);
    } else if (error instanceof Error) {
      log.error(error.stack ?? error.message);
    } else {
      log.error(String(error));
    }

    process.exitCode = 1;
  }
}

// Large summaries can exceed the stdout high-water mark, in which case
// `process.stdout.write()` returns false and the remainder is buffered. The
// deferred `setTimeout(...).unref()` exit in the `.finally()` block below
// would otherwise terminate the process before the buffer drains, truncating
// the JSON summary.
function writeToStdout(chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.stdout.write(chunk)) {
      resolve();
      return;
    }
    process.stdout.once('drain', resolve);
    process.stdout.once('error', reject);
  });
}

main()
  .catch((error: unknown) => {
    if (error instanceof Error) {
      log.error(error.stack ?? error.message);
    } else {
      log.error(String(error));
    }

    process.exitCode = 1;
  })
  .finally(() => {
    // Lingering handles (fetch keep-alive sockets, pg pool idle) can prevent
    // the event loop from draining. Schedule a deferred exit so stdout/stderr
    // have time to flush before the process terminates.
    setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
  });

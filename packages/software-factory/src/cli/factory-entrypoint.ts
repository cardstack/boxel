// This should be first
import '../setup-logger.ts';

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  FactoryEntrypointUsageError,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../factory-entrypoint.ts';
import { FactoryBriefError } from '../factory-brief.ts';
import { configureLogger, logger } from '../logger.ts';

let log = logger('factory-entrypoint');

async function main(): Promise<void> {
  if (wantsFactoryEntrypointHelp(process.argv.slice(2))) {
    console.log(getFactoryEntrypointUsage());
    return;
  }

  let options = parseFactoryEntrypointArgs(process.argv.slice(2));

  // --debug raises the log level so debug-gated lines (e.g. full
  // run-command response bodies) surface, unless the caller has already
  // pinned a level via LOG_LEVELS.
  if (options.debug && !process.env.LOG_LEVELS) {
    configureLogger('*=debug');
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
  })
  .finally(() => {
    // Lingering handles (fetch keep-alive sockets, pg pool idle) can prevent
    // the event loop from draining. Schedule a deferred exit so stdout/stderr
    // have time to flush before the process terminates.
    setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
  });

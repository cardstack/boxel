// This should be first
import '../setup-logger';

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  FactoryEntrypointUsageError,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../factory-entrypoint';
import { FactoryBriefError } from '../factory-brief';
import { configureLogger, logger } from '../logger';

let log = logger('factory-entrypoint');

async function main(): Promise<void> {
  try {
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

    if (!options.debug) {
      process.exit(0);
    }

    let output = JSON.stringify(summary, null, 2) + '\n';
    if (!process.stdout.write(output)) {
      process.stdout.once('drain', () => process.exit(0));
    } else {
      process.exit(0);
    }
  } catch (error) {
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

    process.exit(1);
  }
}

void main();

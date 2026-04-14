// This should be first
import '../setup-logger';

import { BoxelCLIClient } from '@cardstack/boxel-cli/src/lib/boxel-cli-client';

import {
  FactoryEntrypointUsageError,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../factory-entrypoint';
import { FactoryBriefError } from '../factory-brief';
import { logger } from '../logger';

let log = logger('factory-entrypoint');

async function main(): Promise<void> {
  try {
    if (wantsFactoryEntrypointHelp(process.argv.slice(2))) {
      console.log(getFactoryEntrypointUsage());
      return;
    }

    await BoxelCLIClient.ensureProfile();

    let options = parseFactoryEntrypointArgs(process.argv.slice(2));
    log.info(`mode=${options.mode} brief=${options.briefUrl}`);

    if (options.mode === 'implement') {
      log.info('Starting seed issue + issue-driven loop...');
    }

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

// This should be first
import '../setup-logger';

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
      log.info(getFactoryEntrypointUsage());
      return;
    }

    let options = parseFactoryEntrypointArgs(process.argv.slice(2));
    log.info(`mode=${options.mode} brief=${options.briefUrl}`);

    if (options.mode === 'implement') {
      log.info('Starting bootstrap + implement flow...');
    }

    let summary = await runFactoryEntrypoint(options);

    if (summary.implement) {
      log.info(
        `Implement complete: outcome=${summary.implement.outcome} ` +
          `iterations=${summary.implement.iterations} ` +
          `toolCalls=${summary.implement.toolCallCount}`,
      );
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
    } else {
      log.error(String(error));
    }

    process.exit(1);
  }
}

void main();

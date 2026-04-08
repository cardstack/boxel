import {
  FactoryEntrypointUsageError,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../factory-entrypoint';
import { FactoryBriefError } from '../factory-brief';

function log(message: string): void {
  process.stderr.write(`[factory:go] ${message}\n`);
}

async function main(): Promise<void> {
  try {
    if (wantsFactoryEntrypointHelp(process.argv.slice(2))) {
      console.log(getFactoryEntrypointUsage());
      return;
    }

    let options = parseFactoryEntrypointArgs(process.argv.slice(2));
    log(`mode=${options.mode} brief=${options.briefUrl}`);

    if (options.mode === 'implement') {
      log('Starting bootstrap + implement flow...');
    }

    let summary = await runFactoryEntrypoint(options);

    if (summary.implement) {
      log(
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
      console.error(error.message);
      console.error('');
      console.error(getFactoryEntrypointUsage());
    } else if (error instanceof FactoryBriefError) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exit(1);
  }
}

void main();
